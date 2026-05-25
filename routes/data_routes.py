"""routes/data_routes.py — /api/fin, /api/config, /api/query, /api/transactions/*, /api/review/*, /api/budgets"""
from __future__ import annotations

import datetime
import hashlib
import logging
import re
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request

from core.auth import get_current_user, SESSION_COOKIE, _sessions

logger = logging.getLogger("moneytalks")
from core.categories import CAT_MAP, _resolve_category
from core.fin_data import build_fin_data
from core.search import semantic_txn_search
from core.store import (
    data_file, get_conn, load_config, save_config,
    load_df, save_df, load_splits, save_splits,
    load_budgets, save_budgets,
)

router = APIRouter()

REVIEW_BATCH_SIZE = 10

# Blocklist for /api/query — prevent reading arbitrary files via DuckDB table functions
_BLOCKED = re.compile(
    r'\bread_(parquet|csv|json|text|csv_auto)\b|glob\s*\(|read_blob\b',
    re.IGNORECASE,
)


def _fingerprint(s: str) -> str:
    """Normalize a transaction description for fuzzy matching."""
    s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
    s = re.sub(r"[^a-z ]+", " ", s)
    return " ".join(s.split()[:4])


# ---------------------------------------------------------------------------
# Financial data
# ---------------------------------------------------------------------------

@router.get("/api/fin")
def get_fin(current_user: str = Depends(get_current_user)) -> dict:
    if not data_file(current_user).exists():
        return {"hasData": False}
    try:
        return build_fin_data(current_user)
    except Exception:
        logger.exception("build_fin_data failed for user %s", current_user)
        return {"hasData": False}


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@router.get("/api/config")
def get_config(request: Request, current_user: str = Depends(get_current_user)) -> dict:
    cfg     = load_config(current_user)
    token   = request.cookies.get(SESSION_COOKIE)
    session = _sessions.get(token, {})
    return {
        "has_anthropic":      bool(cfg.get("anthropic_api_key")),
        "has_gemini":         bool(cfg.get("gemini_api_key")),
        "preferred_provider": cfg.get("preferred_provider", "claude"),
        "has_plaid":          bool(cfg.get("plaid_client_id") and cfg.get("plaid_secret")),
        "plaid_environment":  cfg.get("plaid_environment", "sandbox"),
        "plaid_redirect_uri": cfg.get("plaid_redirect_uri", ""),
        "is_admin":           bool(session.get("is_admin")),
        "auto_sync_interval": cfg.get("auto_sync_interval", 0),
    }


@router.post("/api/config")
async def update_config(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    allowed = {"anthropic_api_key", "gemini_api_key", "preferred_provider",
               "plaid_client_id", "plaid_secret", "plaid_environment",
               "plaid_redirect_uri", "auto_sync_interval"}
    for k, v in body.items():
        if k in allowed:
            if v is None:
                cfg.pop(k, None)
            else:
                cfg[k] = v
    save_config(current_user, cfg)
    return {"ok": True}


# ---------------------------------------------------------------------------
# SQL query
# ---------------------------------------------------------------------------

@router.post("/api/query")
async def run_query(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    sql = body.get("sql", "").strip()
    if not sql.upper().startswith("SELECT"):
        raise HTTPException(400, "Only SELECT queries are allowed")
    if _BLOCKED.search(sql):
        raise HTTPException(400, "Table functions are not allowed")
    if not data_file(current_user).exists():
        raise HTTPException(404, "No data")
    try:
        conn   = get_conn(current_user)
        result = conn.execute(sql).df()
        return {"columns": list(result.columns), "rows": result.values.tolist()}
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Semantic transaction search
# ---------------------------------------------------------------------------

@router.get("/api/transactions/search")
def semantic_transaction_search(
    q: str = "",
    current_user: str = Depends(get_current_user),
) -> dict:
    return semantic_txn_search(current_user, q)


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@router.patch("/api/transactions/{txn_id}")
async def update_transaction(
    txn_id: str,
    body: dict[str, Any],
    current_user: str = Depends(get_current_user),
) -> dict:
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    _needs_id = df["txn_id"].isna() if "txn_id" in df.columns else pd.Series(True, index=df.index)
    if _needs_id.any():
        if "txn_id" not in df.columns:
            df["txn_id"] = ""
        df.loc[_needs_id, "txn_id"] = df[_needs_id].apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, f"Transaction {txn_id} not found")

    reverse_map = {v: k for k, v in CAT_MAP.items()}

    # Save original category before mutating (needed for auto-learn scope)
    orig_cat = df.loc[mask, "category"].iloc[0] if ("category" in body and "category" in df.columns) else None

    if "category" in body:
        ll_cat = body["category"]
        df.loc[mask, "category"] = reverse_map.get(ll_cat, ll_cat)
        # Sync transaction_type with new category (affects monthly aggregation)
        if "transaction_type" in df.columns:
            if ll_cat == "income":
                df.loc[mask, "transaction_type"] = "income"
            elif ll_cat in ("transfer", "savings", "refund"):
                df.loc[mask, "transaction_type"] = "transfer"
            else:
                df.loc[mask, "transaction_type"] = "expense"
    if "date" in body:
        try:
            df.loc[mask, "date"] = pd.to_datetime(body["date"])
        except Exception:
            raise HTTPException(400, "Invalid date format")
    if "description" in body:
        df.loc[mask, "description"] = str(body["description"]).strip()
    if "amount" in body:
        try:
            new_amount = float(body["amount"])
            df.loc[mask, "expense_amount"] = new_amount
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid amount")
    if "notes" in body:
        if "notes" not in df.columns:
            df["notes"] = ""
        df.loc[mask, "notes"] = body["notes"]
    if "tags" in body:
        if "tags" not in df.columns:
            df["tags"] = ""
        df.loc[mask, "tags"] = body["tags"]

    if "user_edited" not in df.columns:
        df["user_edited"] = False
    df.loc[mask, "user_edited"] = True

    auto_applied = 0
    if "category" in body:
        source_desc = df.loc[mask, "description"].iloc[0]
        ll_cat      = body["category"]
        new_raw_cat = reverse_map.get(ll_cat, ll_cat)

        fp_source = _fingerprint(source_desc)
        # Require 2+ words in fingerprint — single-word descriptions are too generic
        if fp_source and len(fp_source.split()) >= 2:
            not_approved  = ~df["approved"].fillna(False).infer_objects(copy=False).astype(bool) if "approved" in df.columns else pd.Series(True, index=df.index)
            unedited      = ~(df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).infer_objects(copy=False).astype(bool)) | mask
            similar_mask  = df["description"].apply(_fingerprint) == fp_source
            # Only update rows with the same original category AND same transaction type —
            # prevents income/payment rows being changed when you fix an expense
            same_orig_cat = df["category"] == orig_cat
            source_type   = df.loc[mask, "transaction_type"].iloc[0] if "transaction_type" in df.columns else None
            same_type     = (df["transaction_type"] == source_type) if source_type and "transaction_type" in df.columns else pd.Series(True, index=df.index)
            apply_mask    = similar_mask & ~mask & unedited & not_approved & same_orig_cat & same_type
            if apply_mask.any():
                df.loc[apply_mask, "category"]    = new_raw_cat
                df.loc[apply_mask, "user_edited"] = True
                auto_applied = int(apply_mask.sum())

    save_df(current_user, df)
    return {"ok": True, "auto_applied": auto_applied}


@router.delete("/api/transactions/{txn_id}")
async def delete_transaction(
    txn_id: str,
    current_user: str = Depends(get_current_user),
) -> dict:
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")
    if "txn_id" not in df.columns or not (df["txn_id"] == txn_id).any():
        raise HTTPException(404, f"Transaction {txn_id} not found")
    df = df[df["txn_id"] != txn_id].reset_index(drop=True)
    save_df(current_user, df)
    # Also remove any split data for this transaction
    splits = load_splits(current_user)
    if txn_id in splits:
        del splits[txn_id]
        save_splits(current_user, splits)
    return {"ok": True}


@router.post("/api/transactions/{txn_id}/split")
async def split_transaction(
    txn_id: str,
    body: dict[str, Any],
    current_user: str = Depends(get_current_user),
) -> dict:
    splits = body.get("splits", [])
    if len(splits) < 2:
        raise HTTPException(400, "Need at least 2 splits")

    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    _needs_id = df["txn_id"].isna() if "txn_id" in df.columns else pd.Series(True, index=df.index)
    if _needs_id.any():
        if "txn_id" not in df.columns:
            df["txn_id"] = ""
        df.loc[_needs_id, "txn_id"] = df[_needs_id].apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, f"Transaction {txn_id} not found")

    original_amount = abs(float(df.loc[mask, "expense_amount"].iloc[0]))
    split_total     = sum(abs(float(s["amount"])) for s in splits)
    if abs(split_total - original_amount) > 0.02:
        raise HTTPException(400, f"Split amounts ({split_total:.2f}) must equal transaction amount ({original_amount:.2f})")

    if not all(s.get("category") for s in splits):
        raise HTTPException(400, "Each split must have a category")

    normalized = [
        {"category": s["category"], "amount": -abs(float(s["amount"])), "notes": s.get("notes", "")}
        for s in splits
    ]
    data = load_splits(current_user)
    data[txn_id] = normalized
    save_splits(current_user, data)
    return {"ok": True, "splits": len(normalized)}


@router.post("/api/transactions")
async def add_transaction(
    body: dict[str, Any],
    current_user: str = Depends(get_current_user),
) -> dict:
    """Add a one-off manual transaction (e.g. cash)."""
    date        = body.get("date", "")
    description = (body.get("description") or "").strip()
    amount      = body.get("amount")
    category    = (body.get("category") or "Other").strip()
    source      = (body.get("source") or "Cash").strip()
    notes       = (body.get("notes") or "").strip()

    if not date or not description or amount is None:
        raise HTTPException(400, "date, description, and amount are required")

    try:
        amount = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")

    # Determine transaction_type from sign if not supplied
    txn_type = body.get("transaction_type") or ("income" if amount > 0 else "expense")
    # Convention (matches Plaid): expense_amount positive = money out, negative = income
    # fin_data negates expense_amount for display, so: expense → +abs, income → -abs
    expense_amount = abs(amount) if txn_type == "expense" else -abs(amount)

    df = load_df(current_user)
    if df is None:
        # First transaction — create minimal schema
        df = pd.DataFrame(columns=["date", "description", "expense_amount",
                                    "transaction_type", "category", "source",
                                    "notes", "txn_id", "user_edited", "approved", "source_type"])

    new_row = {
        "date":             pd.to_datetime(date).date(),
        "description":      description,
        "expense_amount":   expense_amount,
        "transaction_type": txn_type,
        "category":         category,
        "source":           source,
        "notes":            notes,
        "user_edited":      True,
        "approved":         True,
        "source_type":      "manual",
    }

    # Generate a stable txn_id
    raw = f"{date}|{description}|{expense_amount}|manual"
    new_row["txn_id"] = hashlib.md5(raw.encode()).hexdigest()[:12]

    # Ensure all existing columns exist in new row
    for col in df.columns:
        if col not in new_row:
            new_row[col] = None

    new_df = pd.DataFrame([new_row])
    # Align dtypes loosely
    for col in df.columns:
        if col in new_df.columns and not df.empty:
            try:
                new_df[col] = new_df[col].astype(df[col].dtype)
            except Exception:
                pass

    df = pd.concat([df, new_df], ignore_index=True)
    save_df(current_user, df)
    return {"ok": True, "txn_id": new_row["txn_id"]}


@router.delete("/api/transactions/{txn_id}/split")
async def unsplit_transaction(
    txn_id: str,
    current_user: str = Depends(get_current_user),
) -> dict:
    data = load_splits(current_user)
    if txn_id in data:
        del data[txn_id]
        save_splits(current_user, data)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Auto-categorization helper
# ---------------------------------------------------------------------------

# Keyword → raw category (checked against lowercased description)
_KEYWORD_CATS: list[tuple[str, str]] = [
    # Dining
    ("restaurant", "Dining & Drinks"), ("cafe", "Dining & Drinks"),
    ("coffee", "Dining & Drinks"), ("pizza", "Dining & Drinks"),
    ("sushi", "Dining & Drinks"), ("burger", "Dining & Drinks"),
    ("taco", "Dining & Drinks"), ("tacos", "Dining & Drinks"),
    ("grill", "Dining & Drinks"), ("bar ", "Dining & Drinks"),
    ("brewery", "Dining & Drinks"), ("dining", "Dining & Drinks"),
    ("kitchen", "Dining & Drinks"), ("bistro", "Dining & Drinks"),
    ("diner", "Dining & Drinks"), ("eatery", "Dining & Drinks"),
    ("food", "Dining & Drinks"), ("ramen", "Dining & Drinks"),
    ("pho", "Dining & Drinks"), ("boba", "Dining & Drinks"),
    ("thai", "Dining & Drinks"), ("indian", "Dining & Drinks"),
    ("chinese", "Dining & Drinks"), ("mexican", "Dining & Drinks"),
    ("italian", "Dining & Drinks"), ("bbq", "Dining & Drinks"),
    ("donut", "Dining & Drinks"), ("bakery", "Dining & Drinks"),
    ("deli", "Dining & Drinks"), ("smoothie", "Dining & Drinks"),
    ("juice bar", "Dining & Drinks"), ("ice cream", "Dining & Drinks"),
    ("gelato", "Dining & Drinks"), ("poke", "Dining & Drinks"),
    # Groceries
    ("grocery", "Groceries"), ("market", "Groceries"),
    ("whole foods", "Groceries"), ("trader joe", "Groceries"),
    ("safeway", "Groceries"), ("kroger", "Groceries"),
    ("vons", "Groceries"), ("ralphs", "Groceries"),
    ("costco", "Groceries"), ("walmart", "Groceries"),
    ("target", "Groceries"), ("sprouts", "Groceries"),
    ("aldi", "Groceries"), ("foods co", "Groceries"),
    # Transport
    ("uber", "Commute & Transport"), ("lyft", "Commute & Transport"),
    ("metro", "Commute & Transport"), ("parking", "Commute & Transport"),
    ("gas station", "Commute & Transport"), ("shell", "Commute & Transport"),
    ("chevron", "Commute & Transport"), ("arco", "Commute & Transport"),
    ("exxon", "Commute & Transport"), ("bp ", "Commute & Transport"),
    ("toll", "Commute & Transport"), ("transit", "Commute & Transport"),
    ("amtrak", "Commute & Transport"), ("bart", "Commute & Transport"),
    # Phone / internet bills (utilities)
    ("tello", "Housing & Utilities"), ("t-mobile", "Housing & Utilities"),
    ("verizon", "Housing & Utilities"), ("at&t", "Housing & Utilities"),
    ("sprint", "Housing & Utilities"), ("spectrum", "Housing & Utilities"),
    ("xfinity", "Housing & Utilities"), ("cox ", "Housing & Utilities"),
    ("mint mobile", "Housing & Utilities"), ("visible", "Housing & Utilities"),
    # Subscriptions / digital services
    ("netflix", "Connectivity"), ("spotify", "Connectivity"),
    ("hulu", "Connectivity"), ("disney", "Connectivity"),
    ("apple.com/bill", "Connectivity"), ("amazon prime", "Connectivity"),
    ("youtube", "Connectivity"), ("hbo", "Connectivity"),
    ("paramount", "Connectivity"), ("peacock", "Connectivity"),
    ("claude.ai", "Connectivity"), ("openai", "Connectivity"),
    ("chatgpt", "Connectivity"), ("perplexity", "Connectivity"),
    ("notion", "Connectivity"), ("dropbox", "Connectivity"),
    ("adobe", "Connectivity"), ("microsoft", "Connectivity"),
    ("google one", "Connectivity"), ("icloud", "Connectivity"),
    # Utilities
    ("electric", "Housing & Utilities"), ("water ", "Housing & Utilities"),
    ("utility", "Housing & Utilities"), ("laundry", "Housing & Utilities"),
    ("socalgasgas", "Housing & Utilities"), ("socal gas", "Housing & Utilities"),
    ("pge", "Housing & Utilities"), ("sdge", "Housing & Utilities"),
    ("con ed", "Housing & Utilities"), ("dwp", "Housing & Utilities"),
    # Health
    ("pharmacy", "Health & Medical"), ("cvs", "Health & Medical"),
    ("walgreens", "Health & Medical"), ("clinic", "Health & Medical"),
    ("hospital", "Health & Medical"), ("doctor", "Health & Medical"),
    ("dental", "Health & Medical"), ("vision", "Health & Medical"),
    ("gym", "Fitness & Active"), ("fitness", "Fitness & Active"),
    ("yoga", "Fitness & Active"), ("pilates", "Fitness & Active"),
    ("peloton", "Fitness & Active"), ("orangetheory", "Fitness & Active"),
    # Shopping
    ("amazon", "Shopping & Retail"), ("ebay", "Shopping & Retail"),
    ("etsy", "Shopping & Retail"), ("best buy", "Shopping & Retail"),
    ("apple store", "Shopping & Retail"), ("nike", "Shopping & Retail"),
    ("zara", "Shopping & Retail"), ("h&m", "Shopping & Retail"),
    # Travel
    ("airbnb", "Travel & Getaways"), ("hotel", "Travel & Getaways"),
    ("airline", "Travel & Getaways"), ("united air", "Travel & Getaways"),
    ("delta air", "Travel & Getaways"), ("southwest", "Travel & Getaways"),
    ("alaska air", "Travel & Getaways"), ("american air", "Travel & Getaways"),
    # Education
    ("tuition", "Education"), ("university", "Education"),
    ("college", "Education"), ("udemy", "Education"),
    ("coursera", "Education"), ("skillshare", "Education"),
]

def _auto_categorize(description: str, txn_type: str | None, expense_amount: float) -> str:
    """Return a best-guess raw category for a Pending Review transaction."""
    from core.categories import _resolve_category
    resolved = _resolve_category(description, "Pending Review", txn_type, expense_amount)
    if resolved != "pending-review":
        # Already maps to transfer/income via patterns
        reverse_map = {v: k for k, v in CAT_MAP.items()}
        return reverse_map.get(resolved, resolved)
    desc_lower = description.lower()
    for keyword, cat in _KEYWORD_CATS:
        if keyword in desc_lower:
            return cat
    return "Other"


# ---------------------------------------------------------------------------
# Review workflow
# ---------------------------------------------------------------------------

@router.get("/api/review")
def get_review_batch(current_user: str = Depends(get_current_user)) -> dict:
    df = load_df(current_user)
    if df is None or df.empty:
        return {"batch": [], "total": 0, "approved": 0, "remaining": 0}

    if "approved" not in df.columns:
        df["approved"] = False
        save_df(current_user, df)

    _needs_id = df["txn_id"].isna() if "txn_id" in df.columns else pd.Series(True, index=df.index)
    if _needs_id.any():
        if "txn_id" not in df.columns:
            df["txn_id"] = ""
        df.loc[_needs_id, "txn_id"] = df[_needs_id].apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )
        save_df(current_user, df)

    # Auto-categorize any remaining "Pending Review" transactions.
    # Note: user_edited is intentionally NOT excluded here — if the category is
    # still 'Pending Review', user_edited was set incorrectly and must be cleared.
    pending_mask = (
        df["category"].isin(["Pending Review", "pending review", ""]) | df["category"].isna()
    )
    if pending_mask.any():
        if "user_edited" not in df.columns:
            df["user_edited"] = False
        for idx in df[pending_mask].index:
            row = df.loc[idx]
            df.loc[idx, "category"] = _auto_categorize(
                str(row.get("description", "")),
                row.get("transaction_type"),
                float(row.get("expense_amount", 0) or 0),
            )
            # Clear user_edited — 'Pending Review' was never a real user choice
            df.loc[idx, "user_edited"] = False
        save_df(current_user, df)

    reviewable    = df
    _still_pending = reviewable["category"].isin(["Pending Review", "pending review", ""]) | reviewable["category"].isna()
    approved_mask = reviewable["approved"].fillna(False).infer_objects(copy=False).astype(bool) & ~_still_pending
    total         = len(reviewable)
    n_approved    = int(approved_mask.sum())

    batch_df = (
        reviewable[~approved_mask]
        .assign(_abs_amt=lambda x: x["expense_amount"].abs())
        .sort_values("_abs_amt", ascending=False)
        .drop(columns=["_abs_amt"])
        .head(REVIEW_BATCH_SIZE)
    )

    batch = []
    for _, row in batch_df.iterrows():
        batch.append({
            "id":          row.get("txn_id", ""),
            "date":        str(row["date"])[:10],
            "description": str(row.get("description", "")),
            "amount":      float(row.get("expense_amount", 0)),
            "category":    _resolve_category(
                row.get("description", ""),
                row.get("category", "other"),
                row.get("transaction_type"),
                row.get("expense_amount", 0.0),
            ),
            "source": str(row.get("source", "")),
        })

    cfg           = load_config(current_user)
    streak        = int(cfg.get("review_streak", 0))
    last_reviewed = cfg.get("last_reviewed_date")

    return {
        "batch":         batch,
        "total":         total,
        "approved":      n_approved,
        "remaining":     total - n_approved,
        "streak":        streak,
        "last_reviewed": last_reviewed,
    }


@router.post("/api/review/approve")
async def approve_batch(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    txn_ids   = body.get("ids", [])
    overrides = body.get("overrides", {})

    if not txn_ids:
        raise HTTPException(400, "ids required")

    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    _needs_id = df["txn_id"].isna() if "txn_id" in df.columns else pd.Series(True, index=df.index)
    if _needs_id.any():
        if "txn_id" not in df.columns:
            df["txn_id"] = ""
        df.loc[_needs_id, "txn_id"] = df[_needs_id].apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )
    if "approved" not in df.columns:
        df["approved"] = False
    if "user_edited" not in df.columns:
        df["user_edited"] = False
    if "original_category" not in df.columns:
        df["original_category"] = df["category"]

    reverse_map = {v: k for k, v in CAT_MAP.items()}

    PENDING = {"Pending Review", "pending review", "", None}

    for txn_id in txn_ids:
        mask = df["txn_id"] == txn_id
        if not mask.any():
            continue
        current_cat = df.loc[mask, "category"].iloc[0]
        has_override = txn_id in overrides
        still_pending = current_cat in PENDING or pd.isna(current_cat)
        if still_pending and not has_override:
            # Check if _resolve_category can determine a real category automatically
            txn_type   = df.loc[mask, "transaction_type"].iloc[0] if "transaction_type" in df.columns else None
            exp_amount = float(df.loc[mask, "expense_amount"].iloc[0])
            desc       = str(df.loc[mask, "description"].iloc[0])
            resolved   = _resolve_category(desc, str(current_cat), txn_type, exp_amount)
            if resolved == "pending-review":
                continue  # genuinely no category — skip
            # Auto-assign the resolved category
            df.loc[mask, "category"] = reverse_map.get(resolved, resolved)
        # Stamp original_category once — never overwrite after first set
        orig_already = df.loc[mask, "original_category"].iloc[0]
        if not orig_already or pd.isna(orig_already):
            df.loc[mask, "original_category"] = df.loc[mask, "category"].iloc[0]
        df.loc[mask, "approved"]    = True
        df.loc[mask, "user_edited"] = True   # approved = user has seen & confirmed it; lock against future re-categorization
        if txn_id in overrides:
            ll_cat   = overrides[txn_id]
            orig_cat = df.loc[mask, "category"].iloc[0]   # save before mutating
            df.loc[mask, "category"]    = reverse_map.get(ll_cat, ll_cat)
            df.loc[mask, "user_edited"] = True
            # Sync transaction_type to match the new category
            if "transaction_type" in df.columns:
                if ll_cat == "income":
                    df.loc[mask, "transaction_type"] = "income"
                elif ll_cat in ("transfer", "savings", "refund"):
                    df.loc[mask, "transaction_type"] = "transfer"
                else:
                    df.loc[mask, "transaction_type"] = "expense"

            source_desc = df.loc[mask, "description"].iloc[0]

            fp = _fingerprint(source_desc)
            # Require 2+ words — single-word names like "Store" are too generic
            if fp and len(fp.split()) >= 2:
                not_approved  = ~df["approved"].fillna(False).infer_objects(copy=False).astype(bool)
                not_edited    = ~df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).infer_objects(copy=False).astype(bool)
                similar       = df["description"].apply(_fingerprint) == fp
                same_orig_cat = df["category"] == orig_cat
                source_type   = df.loc[mask, "transaction_type"].iloc[0] if "transaction_type" in df.columns else None
                same_type     = (df["transaction_type"] == source_type) if source_type and "transaction_type" in df.columns else pd.Series(True, index=df.index)
                apply_mask    = similar & not_approved & not_edited & ~mask & same_orig_cat & same_type
                df.loc[apply_mask, "category"]    = reverse_map.get(ll_cat, ll_cat)
                df.loc[apply_mask, "user_edited"] = True

    save_df(current_user, df)

    cfg      = load_config(current_user)
    today    = datetime.date.today()
    iso_week = today.isocalendar()[:2]

    last_week_str = cfg.get("last_reviewed_week")
    streak        = int(cfg.get("review_streak", 0))

    if last_week_str:
        try:
            ly, lw   = map(int, last_week_str.split("-"))
            last_iso = (ly, lw)
        except Exception:
            last_iso = None

        if last_iso == iso_week:
            pass
        else:
            expected_prev = (today - datetime.timedelta(weeks=1)).isocalendar()[:2]
            if last_iso == expected_prev:
                streak += 1
            else:
                streak = 1
    else:
        streak = 1

    cfg["last_reviewed_week"] = f"{iso_week[0]}-{iso_week[1]}"
    cfg["last_reviewed_date"] = today.isoformat()
    cfg["review_streak"]      = streak
    save_config(current_user, cfg)

    from core.categories import map_category as _mc
    _SKIP = {"transfer", "savings", "refund"}
    reviewable     = df[~df["category"].apply(lambda c: _mc(str(c or "")) in _SKIP)]
    _still_pending = reviewable["category"].isin(["Pending Review", "pending review", ""]) | reviewable["category"].isna()
    n_approved     = int((reviewable["approved"].fillna(False).infer_objects(copy=False).astype(bool) & ~_still_pending).sum())
    return {
        "ok":           True,
        "approved":     n_approved,
        "remaining":    len(reviewable) - n_approved,
        "streak":       streak,
        "last_reviewed": today.isoformat(),
    }


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------

@router.get("/api/budgets")
def get_budgets(current_user: str = Depends(get_current_user)) -> dict:
    return load_budgets(current_user)


@router.put("/api/budgets")
async def update_budgets(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    # body: { category_id: amount_or_null, ... }  null removes the budget
    budgets = load_budgets(current_user)
    for cat_id, amount in body.items():
        if amount is None:
            budgets.pop(cat_id, None)
        else:
            budgets[cat_id] = float(amount)
    save_budgets(current_user, budgets)
    return budgets
