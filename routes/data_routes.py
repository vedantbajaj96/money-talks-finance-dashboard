"""routes/data_routes.py — /api/fin, /api/config, /api/query, /api/transactions/*, /api/review/*"""
from __future__ import annotations

import datetime
import hashlib
import re
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.categories import CAT_MAP, _resolve_category
from core.fin_data import build_fin_data
from core.search import semantic_txn_search
from core.store import (
    data_file, get_conn, load_config, save_config,
    load_df, save_df, load_splits, save_splits,
)

router = APIRouter()

REVIEW_BATCH_SIZE = 10


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
        return {"hasData": False}


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.get("/api/config")
def get_config(current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    return {
        "has_anthropic":      bool(cfg.get("anthropic_api_key")),
        "has_gemini":         bool(cfg.get("gemini_api_key")),
        "preferred_provider": cfg.get("preferred_provider", "claude"),
        "has_plaid":          bool(cfg.get("plaid_client_id") and cfg.get("plaid_secret")),
        "plaid_environment":  cfg.get("plaid_environment", "sandbox"),
        "plaid_redirect_uri": cfg.get("plaid_redirect_uri", ""),
    }


@router.post("/api/config")
async def update_config(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    allowed = {"anthropic_api_key", "gemini_api_key", "preferred_provider",
               "plaid_client_id", "plaid_secret", "plaid_environment",
               "plaid_redirect_uri"}
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
    orig_cat = df.loc[mask, "category"].iloc[0] if "category" in body else None

    if "category" in body:
        ll_cat = body["category"]
        df.loc[mask, "category"] = reverse_map.get(ll_cat, ll_cat)
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

        def _fingerprint(s: str) -> str:
            s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
            s = re.sub(r"[^a-z ]+", " ", s)
            return " ".join(s.split()[:4])

        fp_source = _fingerprint(source_desc)
        # Require 2+ words in fingerprint — single-word descriptions are too generic
        if fp_source and len(fp_source.split()) >= 2:
            not_approved  = ~df["approved"].fillna(False).astype(bool) if "approved" in df.columns else pd.Series(True, index=df.index)
            unedited      = ~(df.get("user_edited", False).fillna(False).astype(bool)) | mask
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

    reviewable    = df[~df["category"].isin(["transfer", "Transfer", "Financial & Transfers", "savings", "Savings", "refund", "Refund"])]
    approved_mask = reviewable["approved"].fillna(False).astype(bool)
    total         = len(reviewable)
    n_approved    = int(approved_mask.sum())

    batch_df = (
        reviewable[~approved_mask]
        .assign(_abs_amt=reviewable["expense_amount"].abs())
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

    reverse_map = {v: k for k, v in CAT_MAP.items()}

    PENDING = {"Pending Review", "pending review", "", None}

    for txn_id in txn_ids:
        mask = df["txn_id"] == txn_id
        if not mask.any():
            continue
        current_cat = df.loc[mask, "category"].iloc[0]
        # Only approve if a real category is set or an override is provided
        has_override = txn_id in overrides
        still_pending = current_cat in PENDING or pd.isna(current_cat)
        if still_pending and not has_override:
            continue  # skip — user must assign a real category first
        df.loc[mask, "approved"] = True
        if txn_id in overrides:
            ll_cat   = overrides[txn_id]
            orig_cat = df.loc[mask, "category"].iloc[0]   # save before mutating
            df.loc[mask, "category"]    = reverse_map.get(ll_cat, ll_cat)
            df.loc[mask, "user_edited"] = True

            source_desc = df.loc[mask, "description"].iloc[0]

            def _fp(s: str) -> str:
                s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
                s = re.sub(r"[^a-z ]+", " ", s)
                return " ".join(s.split()[:4])

            fp = _fp(source_desc)
            # Require 2+ words — single-word names like "Store" are too generic
            if fp and len(fp.split()) >= 2:
                not_approved  = ~df["approved"].fillna(False).astype(bool)
                not_edited    = ~df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
                similar       = df["description"].apply(_fp) == fp
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

    reviewable = df[~df["category"].isin(["transfer", "Transfer", "Financial & Transfers", "savings", "Savings", "refund", "Refund"])]
    n_approved = int(reviewable["approved"].fillna(False).astype(bool).sum())
    return {
        "ok":           True,
        "approved":     n_approved,
        "remaining":    len(reviewable) - n_approved,
        "streak":       streak,
        "last_reviewed": today.isoformat(),
    }
