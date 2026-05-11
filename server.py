"""
server.py — FastAPI backend for the MoneyTalks dashboard.

How it fits together
--------------------
The React frontend (moneytalks/) loads once and calls /api/fin to get all data.
Everything else is mutation: uploading CSVs, editing transactions, syncing Plaid.

Data flow:
  CSV upload  →  parsers.py  →  categorizer/  →  data/{user}/transactions.parquet
  Plaid sync  →  plaid_client.py              →  data/{user}/transactions.parquet
  /api/fin    →  DuckDB reads parquet          →  JSON to frontend

Auth:
  - Users stored in data/users.json (bcrypt-style PBKDF2 hashes)
  - Sessions in-memory dict with 7-day TTL, token stored in HTTP-only cookie
  - First user to register becomes admin; admins can create/delete other users
  - All /api/* routes require a valid session cookie (401 otherwise)
  - /api/auth/* and /login are public

Per-user data:
  data/{username}/transactions.parquet  — transactions
  data/{username}/config.json           — API keys (Plaid, Claude, Gemini)
  data/{username}/plaid_items.json      — Plaid linked institutions

Run:
    python3 server.py
"""

from __future__ import annotations

import datetime
import hashlib
import re
import json
import secrets
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import FileResponse, RedirectResponse

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LL_DIR   = BASE_DIR / "moneytalks"

USERS_FILE     = DATA_DIR / "users.json"
SESSION_COOKIE = "mt_session"
SESSION_TTL    = datetime.timedelta(days=7)

app = FastAPI(title="MoneyTalks API")

# ---------------------------------------------------------------------------
# JSX pre-compilation
# ---------------------------------------------------------------------------

import subprocess as _subprocess

JSX_FILES = ["tweaks-panel.jsx", "charts.jsx", "tabs.jsx", "app.jsx"]

def _compile_jsx(jsx_path: Path) -> None:
    js_path = jsx_path.with_suffix(".js.compiled")
    node_script = (
        "const babel=require('@babel/core'),fs=require('fs');"
        f"const r=babel.transformSync(fs.readFileSync({repr(str(LL_DIR))}"
        " + '/' + process.argv[1],'utf8'),{presets:['@babel/preset-react']});"
        "fs.writeFileSync(process.argv[2],r.code);"
    )
    # Simpler: use inline filenames
    script = f"""
const babel = require('@babel/core'), fs = require('fs');
const code = babel.transformSync(fs.readFileSync({repr(str(jsx_path))}, 'utf8'), {{presets: ['@babel/preset-react']}}).code;
fs.writeFileSync({repr(str(js_path))}, code);
"""
    result = _subprocess.run(["node", "-e", script], capture_output=True, text=True, cwd=str(LL_DIR))
    if result.returncode != 0:
        raise RuntimeError(result.stderr[:400])

def _ensure_compiled(name: str) -> Path:
    jsx_path = LL_DIR / name
    js_path  = LL_DIR / name.replace(".jsx", ".js.compiled")
    if not js_path.exists() or jsx_path.stat().st_mtime > js_path.stat().st_mtime:
        print(f"  Compiling {name}...", flush=True)
        _compile_jsx(jsx_path)
    return js_path

print("Compiling JSX...", flush=True)
for _f in JSX_FILES:
    try:
        _ensure_compiled(_f)
    except Exception as _e:
        print(f"  WARNING {_f}: {_e}", flush=True)
print("JSX ready.", flush=True)

# ---------------------------------------------------------------------------
# Semantic search for categories (sentence-transformers, lazy-loaded)
# ---------------------------------------------------------------------------

_sem_model = None          # SentenceTransformer instance once loaded
_sem_cat_cache: dict = {}  # {cache_key: (cat_list, embeddings_array)}
_sem_txn_cache: dict = {}  # {username: {"mtime": float, "merchants": list, "embs": ndarray}}


def _get_sem_model():
    """Lazily load the sentence-transformers model on first use."""
    global _sem_model
    if _sem_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            print("Loading embeddings model (all-MiniLM-L6-v2)…", flush=True)
            _sem_model = SentenceTransformer("all-MiniLM-L6-v2")
            print("Embeddings model ready.", flush=True)
        except Exception as e:
            print(f"sentence-transformers unavailable: {e}", flush=True)
    return _sem_model


def _semantic_rank(query: str, cats: list) -> list:
    """Return cats re-ranked by semantic similarity to query.
    Falls back to the original order if the model is unavailable."""
    import numpy as np

    model = _get_sem_model()
    if model is None or not query.strip():
        return cats

    global _sem_cat_cache
    cache_key = ",".join(c["id"] for c in cats)
    if cache_key not in _sem_cat_cache:
        texts = [f"{c['name']}" for c in cats]
        embs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        _sem_cat_cache[cache_key] = (cats, embs)

    _, cat_embs = _sem_cat_cache[cache_key]
    q_emb = model.encode([query.strip()], normalize_embeddings=True, show_progress_bar=False)[0]
    scores = cat_embs @ q_emb                          # cosine similarity (normalized)
    ranked = sorted(zip(cats, scores.tolist()), key=lambda x: -x[1])
    return [c for c, _ in ranked]


# ---------------------------------------------------------------------------
# Category mapping
#
# The categorizer stores human-readable names in the parquet ("Dining & Drinks").
# The frontend uses short IDs ("dining"). CAT_MAP bridges the two.
# ---------------------------------------------------------------------------

CAT_MAP: dict[str, str] = {
    # ── Categorizer names (current) ────────────────────────────────────────
    "Paycheck & Salary":            "income",
    "Freelance & Side Income":      "income",
    "Investment & Dividend Income": "income",
    "Other Income":                 "income",
    "Financial & Transfers":        "transfer",
    "Housing & Utilities":          "rent",
    "Connectivity":                 "subs",
    "Food Delivery":                "dining",
    "Commute & Transport":          "transport",
    "Dining & Drinks":              "dining",
    "Fitness & Active":             "health",
    "Health & Medical":             "health",
    "Professional Development":     "self_dev",
    "Education":                    "education",
    "Self Development":             "self_dev",
    "Shopping & Retail":            "shopping",
    "Travel & Getaways":            "travel",
    "Reimbursements":               "other",
    # ── Slugified versions (already in parquet) ────────────────────────────
    "paycheck-and-salary":            "income",
    "freelance-and-side-income":      "income",
    "investment-and-dividend-income": "income",
    "other-income":                   "income",
    "financial-and-transfers":        "transfer",
    "housing-and-utilities":          "rent",
    "connectivity":                   "subs",
    "food-delivery":                  "dining",
    "commute-and-transport":          "transport",
    "dining-and-drinks":              "dining",
    "fitness-and-active":             "health",
    "health-and-medical":             "health",
    "professional-development":       "self_dev",
    "education":                      "education",
    "self-development":               "self_dev",
    "shopping-and-retail":            "shopping",
    "travel-and-getaways":            "travel",
    "reimbursements":                 "other",
    # ── Legacy Streamlit names ─────────────────────────────────────────────
    "Food & Drink":   "dining",
    "Groceries":      "groceries",
    "Shopping":       "shopping",
    "Transportation": "transport",
    "Entertainment":  "entertainment",
    "Health":         "health",
    "Travel":         "travel",
    "Utilities":      "utilities",
    "Housing":        "rent",
    "Subscriptions":  "subs",
    "Income":         "income",
    "Reimbursement":  "other",
    "Transfers":      "transfer",
    "Savings":        "savings",
    "Other":          "other",
}

CAT_META: dict[str, dict] = {
    "income":        {"name": "Income",           "group": "income",   "color": "#5ec98a", "icon": "↗"},
    "rent":          {"name": "Rent & Housing",   "group": "fixed",    "color": "#6b8aab", "icon": "◧"},
    "groceries":     {"name": "Groceries",        "group": "variable", "color": "#a3e635", "icon": "◉"},
    "dining":        {"name": "Dining & Bars",    "group": "variable", "color": "#d97757", "icon": "◔"},
    "transport":     {"name": "Transport",        "group": "variable", "color": "#67e8f9", "icon": "◇"},
    "utilities":     {"name": "Utilities",        "group": "fixed",    "color": "#fbbf24", "icon": "◐"},
    "subs":          {"name": "Subscriptions",    "group": "fixed",    "color": "#a78bfa", "icon": "◑"},
    "shopping":      {"name": "Shopping",         "group": "variable", "color": "#ec4899", "icon": "◕"},
    "health":        {"name": "Health & Fitness", "group": "variable", "color": "#22d3ee", "icon": "◙"},
    "travel":        {"name": "Travel",           "group": "variable", "color": "#f97316", "icon": "◭"},
    "entertainment": {"name": "Entertainment",    "group": "variable", "color": "#e879f9", "icon": "◬"},
    "transfer":      {"name": "Transfers",        "group": "transfer", "color": "#64748b", "icon": "⇄"},
    "savings":       {"name": "Savings",          "group": "transfer", "color": "#34d399", "icon": "⊕"},
    "education":     {"name": "Education",         "group": "variable", "color": "#818cf8", "icon": "◈"},
    "self_dev":      {"name": "Self Development",  "group": "variable", "color": "#fb7185", "icon": "◍"},
    "other":         {"name": "Other",            "group": "variable", "color": "#94a3b8", "icon": "○"},
}

ACCOUNT_COLORS = ["#5ec98a", "#67e8f9", "#d97757", "#a78bfa", "#fbbf24", "#6b8aab", "#f97316", "#e879f9"]

# Substrings in the description that always mean "transfer", regardless of what
# the categorizer said. Credit card autopayments often get tagged "Other Income".
_TRANSFER_DESC_PATTERNS = [
    "automatic payment",
    "payment - thank",
    "payment thank you",
    "payment-thank",
    "online transfer from",
    "online transfer to",
    "payment to chase",
    "payment to discover",
    "payment to amex",
    "payment to citi",
    "payment to bank of america",
    "payment to wells fargo",
    "e-payment",
    "acctverify",
    "penny test",
    "account transfer",
    "ach transfer",
]

_REIMBURSEMENT_CATS = {"reimbursements", "Reimbursements"}


def map_category(cat: str) -> str:
    if cat in CAT_MAP:
        return CAT_MAP[cat]
    return cat.lower().replace(" ", "-").replace("&", "and")


def _resolve_category(description: str, raw_category: str, txn_type: str | None, expense_amount: float = 0.0) -> str:
    """Map a raw parquet category to a frontend category ID.

    Priority order:
      1. Description matches a transfer pattern  → "transfer"
      2. Category maps to transfer               → "transfer"
      3. Reimbursement category                  → "other"
      4. transaction_type=income or amount < 0   → "income"
      5. Everything else                         → expense category ID
    """
    desc_lower = description.lower()
    if any(p in desc_lower for p in _TRANSFER_DESC_PATTERNS):
        return "transfer"

    cat_id = map_category(raw_category or "other")

    if cat_id == "transfer":
        return "transfer"

    if raw_category in _REIMBURSEMENT_CATS or cat_id == "reimbursements":
        return "other"

    is_income = (txn_type == "income") or (txn_type is None and expense_amount < 0)
    if is_income:
        return "income"

    return cat_id


# ---------------------------------------------------------------------------
# Authentication
#
# Passwords: PBKDF2-HMAC-SHA256, 200k iterations, random 16-byte hex salt.
# Sessions:  random 32-byte hex token stored in an HTTP-only cookie.
#            In-memory dict; server restart invalidates all sessions (acceptable
#            for a local family app).
# Roles:     first registered user becomes admin; admins create/delete others.
# ---------------------------------------------------------------------------

# In-memory session store: {token: {"username": str, "is_admin": bool, "expires": datetime}}
_sessions: dict[str, dict] = {}


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Return (hex_hash, salt). If salt is None, a new random one is generated."""
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return dk.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    h, _ = _hash_password(password, salt)
    return secrets.compare_digest(h, stored_hash)


def _load_users() -> dict:
    """Load users registry from disk. Keys are usernames."""
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_users(users: dict) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2))


def _create_session(username: str, is_admin: bool) -> str:
    """Create a new session token and register it in-memory."""
    token = secrets.token_hex(32)
    _sessions[token] = {
        "username": username,
        "is_admin": is_admin,
        "expires":  datetime.datetime.utcnow() + SESSION_TTL,
    }
    return token


def get_current_user(request: Request) -> str:
    """FastAPI dependency — returns username or raises 401.

    Used on all /api/* routes except /api/auth/*.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _sessions.get(token)
    if not session:
        raise HTTPException(401, "Invalid session")
    if datetime.datetime.utcnow() > session["expires"]:
        del _sessions[token]
        raise HTTPException(401, "Session expired")
    return session["username"]


def get_admin_user(request: Request) -> str:
    """FastAPI dependency — returns username or raises 403 if not admin."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _sessions.get(token)
    if not session or datetime.datetime.utcnow() > session["expires"]:
        raise HTTPException(401, "Invalid or expired session")
    if not session.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return session["username"]


# ---------------------------------------------------------------------------
# Per-user path helpers
# ---------------------------------------------------------------------------

def _user_dir(username: str) -> Path:
    return DATA_DIR / username

def _data_file(username: str) -> Path:
    return _user_dir(username) / "transactions.parquet"

def _config_file(username: str) -> Path:
    return _user_dir(username) / "config.json"

def _plaid_items_file(username: str) -> Path:
    return _user_dir(username) / "plaid_items.json"

def _splits_file(username: str) -> Path:
    return _user_dir(username) / "splits.json"

def _load_splits(username: str) -> dict:
    f = _splits_file(username)
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            return {}
    return {}

def _save_splits(username: str, data: dict) -> None:
    _splits_file(username).write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# DuckDB helpers
#
# One fresh in-memory connection per request — cheap because DuckDB reads
# directly from the parquet file without loading it all into RAM.
# ---------------------------------------------------------------------------

def _conn(username: str) -> duckdb.DuckDBPyConnection:
    """Return a DuckDB connection with the user's parquet registered as 'txns'."""
    c = duckdb.connect()
    path = str(_data_file(username)).replace("'", "''")
    c.execute(f"CREATE VIEW txns AS SELECT * FROM read_parquet('{path}')")
    return c


def _month_labels(key: str) -> tuple[str, str, str]:
    """'2024-03' → ('Mar 2024', 'Mar', 'Mar 24')"""
    dt = datetime.date(int(key[:4]), int(key[5:7]), 1)
    return dt.strftime("%b %Y"), dt.strftime("%b"), dt.strftime("%b %y")


# ---------------------------------------------------------------------------
# Config helpers  (config.json stores API keys — gitignored)
# ---------------------------------------------------------------------------

def load_config(username: str) -> dict:
    f = _config_file(username)
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    return {}


def save_config(username: str, cfg: dict) -> None:
    f = _config_file(username)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cfg, indent=2))


# ---------------------------------------------------------------------------
# Pandas helpers  (only used for writes — reads go through DuckDB)
# ---------------------------------------------------------------------------

def load_df(username: str) -> pd.DataFrame | None:
    f = _data_file(username)
    if not f.exists():
        return None
    try:
        df = pd.read_parquet(f)
        return df if not df.empty else None
    except Exception:
        return None


def save_df(username: str, df: pd.DataFrame) -> None:
    f = _data_file(username)
    f.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(f, index=False)


# ---------------------------------------------------------------------------
# build_fin_data  — the heart of /api/fin
#
# Queries the parquet file with DuckDB and assembles the JSON object the
# React frontend consumes. Called once per page load; everything the UI
# needs (transactions, accounts, categories, recurring, net worth) is here.
# ---------------------------------------------------------------------------

def build_fin_data(username: str) -> dict:
    conn = _conn(username)

    # ── MONTHS ────────────────────────────────────────────────────────────
    month_keys = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT strftime(date, '%Y-%m') AS m FROM txns ORDER BY m"
        ).fetchall()
    ]
    months = [
        {"key": k, "label": _month_labels(k)[0], "short": _month_labels(k)[1]}
        for k in month_keys
    ]

    # ── ACCOUNTS ──────────────────────────────────────────────────────────
    # Try to fetch live balances from Plaid; fall back gracefully
    plaid_balances: dict[str, dict] = {}
    try:
        import sys
        sys.path.insert(0, str(BASE_DIR))
        from plaid_client import get_account_balances, is_configured
        cfg = load_config(username)
        if is_configured(cfg):
            data_dir = str(_user_dir(username))
            for b in get_account_balances(cfg=cfg, data_dir=data_dir):
                inst = b["institution_name"]
                key  = f"Plaid – {inst}"
                if key not in plaid_balances:
                    plaid_balances[key] = {"balance": 0.0, "type": b["account_type"]}
                plaid_balances[key]["balance"] += b["current_balance"]
    except Exception:
        pass

    sources = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT source FROM txns ORDER BY source"
        ).fetchall()
    ]
    accounts = [
        {
            "id":      s,
            "name":    s,
            "inst":    s,
            "type":    plaid_balances.get(s, {}).get("type", "checking"),
            "last4":   "????",
            "balance": plaid_balances.get(s, {}).get("balance", 0.0),
            "color":   ACCOUNT_COLORS[i % len(ACCOUNT_COLORS)],
        }
        for i, s in enumerate(sources)
    ]

    # ── CATEGORIES ────────────────────────────────────────────────────────
    raw_cats = [
        r[0] for r in conn.execute("SELECT DISTINCT category FROM txns").fetchall()
    ]
    seen_cat_ids: set[str] = {"income"}
    dynamic_cats: dict[str, dict] = {}
    for raw_cat in raw_cats:
        cat_id = map_category(str(raw_cat))
        seen_cat_ids.add(cat_id)
        if cat_id not in CAT_META:
            dynamic_cats[cat_id] = {
                "name": str(raw_cat), "group": "variable",
                "color": "#94a3b8", "icon": "○",
            }
    all_meta = {**CAT_META, **dynamic_cats}
    categories = [{"id": k, **v} for k, v in all_meta.items()]

    # ── TRANSACTIONS ──────────────────────────────────────────────────────
    col_names = {r[0] for r in conn.execute("DESCRIBE txns").fetchall()}
    select_txn_id  = "txn_id"           if "txn_id"           in col_names else "NULL"
    select_notes   = "notes"            if "notes"            in col_names else "NULL"
    select_tags    = "tags"             if "tags"             in col_names else "NULL"
    select_txn_type = "transaction_type" if "transaction_type" in col_names else "NULL"

    rows = conn.execute(f"""
        SELECT
            date, description, expense_amount, category, source,
            {select_txn_id}   AS txn_id,
            {select_notes}    AS notes,
            {select_tags}     AS tags,
            {select_txn_type} AS txn_type
        FROM txns
        ORDER BY date DESC
    """).fetchall()

    transactions = []
    for date, desc, expense_amount, category, source, txn_id, notes, tags, txn_type in rows:
        if not txn_id:
            txn_id = hashlib.md5(
                f"{date}|{desc}|{expense_amount}".encode()
            ).hexdigest()[:12]
        cat_id = _resolve_category(str(desc), str(category or "other"), txn_type, float(expense_amount or 0))
        transactions.append({
            "id":       str(txn_id),
            "date":     str(date)[:10],
            "merchant": str(desc),
            "category": cat_id,
            "amount":   round(-float(expense_amount), 2),
            "account":  str(source or ""),
            "pending":  False,
            "notes":    str(notes or ""),
            "tags":     str(tags or ""),
        })

    # ── APPLY SPLITS ──────────────────────────────────────────────────────
    splits_data = _load_splits(username)
    if splits_data:
        expanded = []
        for t in transactions:
            if t["id"] in splits_data:
                parts = splits_data[t["id"]]
                for i, s in enumerate(parts):
                    expanded.append({
                        **t,
                        "id":          f"{t['id']}_s{i}",
                        "category":    s["category"],
                        "amount":      round(float(s["amount"]), 2),
                        "notes":       s.get("notes", ""),
                        "is_split":    True,
                        "parent_id":   t["id"],
                        "split_label": f"{s.get('notes', '') or s['category']} ({i+1}/{len(parts)})",
                    })
            else:
                expanded.append(t)
        transactions = expanded

    # ── NET WORTH HISTORY ─────────────────────────────────────────────────
    nw_rows = conn.execute("""
        WITH monthly AS (
            SELECT
                strftime(date, '%Y-%m') AS month,
                SUM(CASE WHEN transaction_type = 'income'  THEN ABS(expense_amount) ELSE 0 END) AS inc,
                SUM(CASE WHEN transaction_type = 'expense' THEN expense_amount       ELSE 0 END) AS exp
            FROM txns
            GROUP BY month
        )
        SELECT
            month,
            SUM(inc - exp) OVER (ORDER BY month) AS running_net
        FROM monthly
        ORDER BY month
    """).fetchall()

    nw_history = [
        {
            "month":       _month_labels(r[0])[2],
            "assets":      round(max(float(r[1]), 0), 2),
            "liabilities": round(max(-float(r[1]), 0), 2),
        }
        for r in nw_rows
    ]

    # ── RECURRING ─────────────────────────────────────────────────────────
    recurring = []
    try:
        import sys, calendar as _cal
        sys.path.insert(0, str(BASE_DIR))
        from subscriptions import detect_recurring
        df = pd.read_parquet(_data_file(username))
        rec_df = detect_recurring(df)
        if not rec_df.empty:
            today = datetime.date.today()
            for _, row in rec_df.iterrows():
                cat_id = map_category(str(row.get("category", "other")))
                matches = df[df["description"] == row["description"]]
                freq    = str(row.get("frequency", "Monthly"))
                last    = row.get("last_charge")
                # Convert last_charge to date object
                if last is None:
                    last_date = today
                elif hasattr(last, 'date'):
                    last_date = last.date()
                elif hasattr(last, 'year'):
                    last_date = last
                else:
                    try:
                        last_date = datetime.date.fromisoformat(str(last))
                    except Exception:
                        last_date = today
                # Compute next charge date
                try:
                    if freq == "Weekly":
                        next_date = last_date + datetime.timedelta(days=7)
                    elif freq == "Bi-weekly":
                        next_date = last_date + datetime.timedelta(days=14)
                    elif freq == "Monthly":
                        m = last_date.month % 12 + 1
                        y = last_date.year + (1 if last_date.month == 12 else 0)
                        d = min(last_date.day, _cal.monthrange(y, m)[1])
                        next_date = datetime.date(y, m, d)
                    elif freq == "Quarterly":
                        next_date = last_date + datetime.timedelta(days=91)
                    elif freq == "Annual":
                        try:
                            next_date = datetime.date(last_date.year + 1, last_date.month, last_date.day)
                        except ValueError:
                            next_date = datetime.date(last_date.year + 1, last_date.month, last_date.day - 1)
                    else:
                        next_date = last_date + datetime.timedelta(days=30)
                    # If already past, advance by one period until it's in the future
                    while next_date < today:
                        if freq == "Weekly":
                            next_date += datetime.timedelta(days=7)
                        elif freq == "Bi-weekly":
                            next_date += datetime.timedelta(days=14)
                        elif freq in ("Monthly", "Quarterly", "Annual"):
                            next_date += datetime.timedelta(days=30)
                        else:
                            next_date += datetime.timedelta(days=30)
                except Exception:
                    next_date = today + datetime.timedelta(days=30)

                recurring.append({
                    "merchant":    str(row["description"]),
                    "category":    cat_id,
                    "amount":      float(row["amount"]),
                    "freq":        freq,
                    "account":     str(matches["source"].iloc[0]) if not matches.empty else "",
                    "next":        next_date.isoformat(),
                    "day":         next_date.day,
                    "occurrences": int(row.get("occurrences", 0)),
                    "est_monthly": float(row.get("est_monthly_cost", float(row["amount"]))),
                    "last_charge": last_date.isoformat(),
                })
    except Exception:
        pass

    return {
        "hasData":           True,
        "ACCOUNTS":          accounts,
        "CATEGORIES":        categories,
        "MONTHS":            months,
        "TRANSACTIONS":      transactions,
        "RECURRING":         recurring,
        "NET_WORTH_HISTORY": nw_history,
    }


def _migrate_legacy_data(user_dir: Path) -> None:
    """Move pre-auth data files (data/transactions.parquet, config.json,
    data/plaid_items.json) into the first user's directory, if they exist
    and the destination doesn't already have data."""
    import shutil

    legacy_txn    = DATA_DIR / "transactions.parquet"
    legacy_cfg    = BASE_DIR / "config.json"
    legacy_plaid  = DATA_DIR / "plaid_items.json"

    if legacy_txn.exists() and not (user_dir / "transactions.parquet").exists():
        shutil.copy2(legacy_txn, user_dir / "transactions.parquet")

    if legacy_cfg.exists() and not (user_dir / "config.json").exists():
        shutil.copy2(legacy_cfg, user_dir / "config.json")

    if legacy_plaid.exists() and not (user_dir / "plaid_items.json").exists():
        shutil.copy2(legacy_plaid, user_dir / "plaid_items.json")


# ---------------------------------------------------------------------------
# Auth routes  (no session cookie required)
# ---------------------------------------------------------------------------

@app.get("/api/auth/status")
def auth_status() -> dict:
    """Return whether any users exist yet (drives first-run setup on the login page)."""
    users = _load_users()
    return {"needs_setup": len(users) == 0}


@app.post("/api/auth/setup")
async def auth_setup(body: dict[str, Any], response: Response) -> dict:
    """Create the first admin account. Only works when no users exist yet."""
    users = _load_users()
    if users:
        raise HTTPException(400, "Setup already completed")
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "Username and password are required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    pw_hash, salt = _hash_password(password)
    users[username] = {
        "hash":         pw_hash,
        "salt":         salt,
        "is_admin":     True,
        "display_name": username,
        "created_at":   datetime.datetime.utcnow().isoformat(),
    }
    _save_users(users)
    user_dir = _user_dir(username)
    user_dir.mkdir(parents=True, exist_ok=True)

    # Migrate pre-auth data files into the first user's directory
    _migrate_legacy_data(user_dir)

    token = _create_session(username, is_admin=True)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=int(SESSION_TTL.total_seconds()))
    return {"ok": True, "username": username, "is_admin": True}


@app.post("/api/auth/login")
async def auth_login(body: dict[str, Any], response: Response) -> dict:
    """Authenticate a user and set a session cookie."""
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    users = _load_users()
    user = users.get(username)
    if not user or not _verify_password(password, user["hash"], user["salt"]):
        raise HTTPException(401, "Invalid username or password")

    token = _create_session(username, is_admin=bool(user.get("is_admin")))
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=int(SESSION_TTL.total_seconds()))
    return {"ok": True, "username": username, "is_admin": bool(user.get("is_admin"))}


@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response) -> dict:
    """Invalidate the current session."""
    token = request.cookies.get(SESSION_COOKIE)
    if token and token in _sessions:
        del _sessions[token]
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
def auth_me(request: Request, current_user: str = Depends(get_current_user)) -> dict:
    """Return info about the currently logged-in user."""
    token = request.cookies.get(SESSION_COOKIE)
    session = _sessions.get(token, {})
    users = _load_users()
    user = users.get(current_user, {})
    return {
        "username":     current_user,
        "display_name": user.get("display_name") or current_user,
        "is_admin":     bool(session.get("is_admin")),
    }


@app.patch("/api/auth/me")
async def update_me(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Update the current user's display name."""
    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(400, "Display name cannot be empty")
    if len(display_name) > 40:
        raise HTTPException(400, "Display name must be 40 characters or fewer")
    users = _load_users()
    users[current_user]["display_name"] = display_name
    _save_users(users)
    return {"ok": True, "display_name": display_name}


# ── User management (admin only) ──────────────────────────────────────────

@app.post("/api/auth/register")
async def auth_register(body: dict[str, Any], admin: str = Depends(get_admin_user)) -> dict:
    """Admin: create a new user account."""
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "Username and password are required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    users = _load_users()
    if username in users:
        raise HTTPException(400, f"User '{username}' already exists")

    pw_hash, salt = _hash_password(password)
    users[username] = {
        "hash":         pw_hash,
        "salt":         salt,
        "is_admin":     bool(body.get("is_admin", False)),
        "display_name": username,
        "created_at":   datetime.datetime.utcnow().isoformat(),
    }
    _save_users(users)
    _user_dir(username).mkdir(parents=True, exist_ok=True)
    return {"ok": True, "username": username}


@app.get("/api/auth/users")
def auth_list_users(admin: str = Depends(get_admin_user)) -> dict:
    """Admin: list all registered users."""
    users = _load_users()
    return {
        "users": [
            {"username": u, "is_admin": bool(v.get("is_admin")), "created_at": v.get("created_at")}
            for u, v in users.items()
        ]
    }


@app.delete("/api/auth/users/{username}")
async def auth_delete_user(username: str, admin: str = Depends(get_admin_user)) -> dict:
    """Admin: delete a user account (cannot delete yourself)."""
    if username == admin:
        raise HTTPException(400, "Cannot delete your own account")
    users = _load_users()
    if username not in users:
        raise HTTPException(404, f"User '{username}' not found")
    del users[username]
    _save_users(users)
    # Invalidate any active sessions for the deleted user
    for token, s in list(_sessions.items()):
        if s["username"] == username:
            del _sessions[token]
    return {"ok": True}


@app.post("/api/auth/change-password")
async def auth_change_password(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Change the current user's password."""
    old_pw = body.get("old_password") or ""
    new_pw = body.get("new_password") or ""
    if not old_pw or not new_pw:
        raise HTTPException(400, "old_password and new_password are required")
    if len(new_pw) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    users = _load_users()
    user = users[current_user]
    if not _verify_password(old_pw, user["hash"], user["salt"]):
        raise HTTPException(401, "Current password is incorrect")

    pw_hash, salt = _hash_password(new_pw)
    users[current_user]["hash"] = pw_hash
    users[current_user]["salt"] = salt
    _save_users(users)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Protected API routes — all require a valid session cookie
# ---------------------------------------------------------------------------

@app.get("/api/fin")
def get_fin(current_user: str = Depends(get_current_user)) -> dict:
    """Main data endpoint — called once on page load by data.js."""
    if not _data_file(current_user).exists():
        return {"hasData": False}
    try:
        return build_fin_data(current_user)
    except Exception:
        return {"hasData": False}


@app.get("/api/config")
def get_config(current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    return {
        "has_anthropic":      bool(cfg.get("anthropic_api_key")),
        "has_gemini":         bool(cfg.get("gemini_api_key")),
        "preferred_provider": cfg.get("preferred_provider", "claude"),
        "has_plaid":          bool(cfg.get("plaid_client_id") and cfg.get("plaid_secret")),
    }


@app.post("/api/config")
async def update_config(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    allowed = {"anthropic_api_key", "gemini_api_key", "preferred_provider",
               "plaid_client_id", "plaid_secret", "plaid_environment"}
    for k, v in body.items():
        if k in allowed:
            cfg[k] = v
    save_config(current_user, cfg)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Custom categories CRUD
# ---------------------------------------------------------------------------
# Categories CRUD + reorder
# ---------------------------------------------------------------------------

def _build_cat_list(cfg: dict) -> list:
    """Return the full ordered category list with user overrides applied."""
    custom      = {c["id"]: c for c in (cfg.get("custom_categories") or [])}
    overrides   = cfg.get("category_overrides") or {}
    order       = cfg.get("category_order") or []
    hidden      = set(cfg.get("hidden_categories") or [])

    # Merge: builtin + custom, skipping hidden
    all_cats = {}
    for kid, v in CAT_META.items():
        if kid in hidden:
            continue
        entry = {"id": kid, **v, "builtin": True}
        if kid in overrides:
            entry.update({k: v2 for k, v2 in overrides[kid].items() if k in ("name","color")})
        all_cats[kid] = entry
    for cid, c in custom.items():
        if cid not in hidden:
            all_cats[cid] = {"builtin": False, **c}

    # Apply order: ordered first, then remaining alphabetically
    ordered = [all_cats[i] for i in order if i in all_cats]
    rest    = [all_cats[i] for i in all_cats if i not in order]
    return ordered + rest


@app.get("/api/categories")
def get_categories(current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    return {"categories": _build_cat_list(cfg)}


@app.get("/api/categories/search")
def search_categories(q: str = "", current_user: str = Depends(get_current_user)) -> dict:
    """Return categories semantically ranked by query.
    Used by the CategoryPicker search box."""
    cfg  = load_config(current_user)
    cats = [c for c in _build_cat_list(cfg) if c["id"] not in ("transfer", "savings")]
    if not q.strip():
        return {"categories": cats, "semantic": False}
    ranked = _semantic_rank(q, cats)
    return {"categories": ranked, "semantic": True}


@app.get("/api/transactions/search")
def semantic_transaction_search(
    q: str = "",
    current_user: str = Depends(get_current_user),
) -> dict:
    """Return merchant names semantically matching the query.
    The frontend filters its local TRANSACTIONS list using this merchant list.
    """
    import numpy as np

    if not q.strip():
        return {"merchants": [], "semantic": False}

    model = _get_sem_model()
    if model is None:
        return {"merchants": [], "semantic": False, "error": "model unavailable"}

    data_file = _data_file(current_user)
    if not data_file.exists():
        return {"merchants": [], "semantic": False}

    # Invalidate cache when parquet is updated
    mtime = data_file.stat().st_mtime
    cached = _sem_txn_cache.get(current_user, {})
    if cached.get("mtime") != mtime:
        conn = _conn(current_user)
        rows = conn.execute(
            "SELECT DISTINCT description FROM txns ORDER BY description"
        ).fetchall()
        merchants = [r[0] for r in rows if r[0]]
        if not merchants:
            return {"merchants": [], "semantic": False}
        embs = model.encode(merchants, normalize_embeddings=True, show_progress_bar=False)
        _sem_txn_cache[current_user] = {"mtime": mtime, "merchants": merchants, "embs": embs}
        cached = _sem_txn_cache[current_user]

    merchants = cached["merchants"]
    embs      = cached["embs"]

    q_emb  = model.encode([q.strip()], normalize_embeddings=True, show_progress_bar=False)[0]
    scores = embs @ q_emb  # cosine similarity

    threshold = 0.25
    hits = [(m, float(s)) for m, s in zip(merchants, scores) if s > threshold]
    hits.sort(key=lambda x: -x[1])

    return {"merchants": [m for m, _ in hits[:100]], "semantic": True}


@app.post("/api/categories")
async def create_category(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    cat_id = re.sub(r"[^a-z0-9_]", "_", name.lower().strip())[:32]
    cfg    = load_config(current_user)
    custom = cfg.get("custom_categories") or []
    if cat_id in CAT_META or any(c["id"] == cat_id for c in custom):
        raise HTTPException(409, "category already exists")
    entry = {"id": cat_id, "name": name,
             "color": body.get("color") or "#94a3b8",
             "icon":  body.get("icon")  or "○",
             "group": body.get("group") or "variable"}
    custom.append(entry)
    cfg["custom_categories"] = custom
    # Append to end of order
    order = cfg.get("category_order") or []
    order.append(cat_id)
    cfg["category_order"] = order
    save_config(current_user, cfg)
    return {"ok": True, "category": {**entry, "builtin": False}}


@app.patch("/api/categories/{cat_id}")
async def update_category(cat_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    if cat_id in CAT_META:
        # Store override for built-in
        overrides = cfg.get("category_overrides") or {}
        if cat_id not in overrides:
            overrides[cat_id] = {}
        if "name"  in body: overrides[cat_id]["name"]  = body["name"]
        if "color" in body: overrides[cat_id]["color"] = body["color"]
        cfg["category_overrides"] = overrides
        save_config(current_user, cfg)
        return {"ok": True}
    # Custom category
    custom = cfg.get("custom_categories") or []
    for c in custom:
        if c["id"] == cat_id:
            if "name"  in body: c["name"]  = body["name"]
            if "color" in body: c["color"] = body["color"]
            if "group" in body: c["group"] = body["group"]
            cfg["custom_categories"] = custom
            save_config(current_user, cfg)
            return {"ok": True}
    raise HTTPException(404, "category not found")


@app.post("/api/categories/reorder")
async def reorder_categories(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    order = body.get("order") or []
    cfg   = load_config(current_user)
    cfg["category_order"] = order
    save_config(current_user, cfg)
    return {"ok": True}


@app.delete("/api/categories/{cat_id}")
async def delete_category(cat_id: str, current_user: str = Depends(get_current_user)) -> dict:
    # Check transaction usage first (applies to both built-in and custom)
    df    = load_df(current_user)
    count = 0
    if df is not None and not df.empty:
        used  = df["category"].astype(str).str.lower() == cat_id.lower()
        count = int(used.sum())
    if count > 0:
        raise HTTPException(409, f"{count} transaction{'s' if count != 1 else ''} use this category — reassign them first")

    cfg = load_config(current_user)

    if cat_id in CAT_META:
        # Built-in with no transactions: hide it (don't actually remove from CAT_META)
        hidden = cfg.get("hidden_categories") or []
        if cat_id not in hidden:
            hidden.append(cat_id)
        cfg["hidden_categories"] = hidden
        cfg["category_order"] = [i for i in (cfg.get("category_order") or []) if i != cat_id]
        save_config(current_user, cfg)
        return {"ok": True}

    # Custom category
    custom = cfg.get("custom_categories") or []
    new_custom = [c for c in custom if c["id"] != cat_id]
    if len(new_custom) == len(custom):
        raise HTTPException(404, "category not found")
    cfg["custom_categories"] = new_custom
    cfg["category_order"] = [i for i in (cfg.get("category_order") or []) if i != cat_id]
    save_config(current_user, cfg)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Transaction Review (weekly approve workflow)
# ---------------------------------------------------------------------------

REVIEW_BATCH_SIZE = 10

@app.get("/api/review")
def get_review_batch(current_user: str = Depends(get_current_user)) -> dict:
    """Return the next batch of unapproved transactions (oldest first) + progress stats."""
    df = load_df(current_user)
    if df is None or df.empty:
        return {"batch": [], "total": 0, "approved": 0, "remaining": 0}

    if "approved" not in df.columns:
        df["approved"] = False
        save_df(current_user, df)

    if "txn_id" not in df.columns:
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )
        save_df(current_user, df)

    # Exclude transfers and savings from the review queue
    reviewable = df[~df["category"].isin(["transfer", "Transfer", "Financial & Transfers",
                                           "savings", "Savings"])]
    approved_mask = reviewable["approved"].fillna(False).astype(bool)
    total     = len(reviewable)
    n_approved = int(approved_mask.sum())
    remaining  = total - n_approved

    batch_df = (
        reviewable[~approved_mask]
        .sort_values("date")
        .head(REVIEW_BATCH_SIZE)
    )

    def _resolve(row) -> str:
        return _resolve_category(
            row.get("description", ""),
            row.get("category", "other"),
            row.get("transaction_type"),
            row.get("expense_amount", 0.0),
        )

    batch = []
    for _, row in batch_df.iterrows():
        batch.append({
            "id":          row.get("txn_id", ""),
            "date":        str(row["date"])[:10],
            "description": str(row.get("description", "")),
            "amount":      float(row.get("expense_amount", 0)),
            "category":    _resolve(row),
            "source":      str(row.get("source", "")),
        })

    return {
        "batch":     batch,
        "total":     total,
        "approved":  n_approved,
        "remaining": remaining,
    }


@app.post("/api/review/approve")
async def approve_batch(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Mark a list of transaction IDs as approved (with optional category overrides)."""
    txn_ids   = body.get("ids", [])
    overrides = body.get("overrides", {})   # {txn_id: new_category}

    if not txn_ids:
        raise HTTPException(400, "ids required")

    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    if "txn_id" not in df.columns:
        df["txn_id"] = df.apply(
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

    for txn_id in txn_ids:
        mask = df["txn_id"] == txn_id
        if not mask.any():
            continue
        df.loc[mask, "approved"] = True
        if txn_id in overrides:
            ll_cat = overrides[txn_id]
            df.loc[mask, "category"]    = reverse_map.get(ll_cat, ll_cat)
            df.loc[mask, "user_edited"] = True

            # Auto-learn: apply to similar unapproved transactions
            source_desc = df.loc[mask, "description"].iloc[0]
            def _fp(s: str) -> str:
                s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
                s = re.sub(r"[^a-z ]+", " ", s)
                return " ".join(s.split()[:4])
            fp = _fp(source_desc)
            if fp:
                not_approved = ~df["approved"].fillna(False).astype(bool)
                similar = df["description"].apply(_fp) == fp
                df.loc[similar & not_approved & ~mask, "category"]    = reverse_map.get(ll_cat, ll_cat)
                df.loc[similar & not_approved & ~mask, "user_edited"] = True

    save_df(current_user, df)

    # Return fresh stats
    reviewable     = df[~df["category"].isin(["transfer", "Transfer", "Financial & Transfers",
                                               "savings", "Savings"])]
    n_approved     = int(reviewable["approved"].fillna(False).astype(bool).sum())
    return {
        "ok":       True,
        "approved": n_approved,
        "remaining": len(reviewable) - n_approved,
    }



@app.patch("/api/transactions/{txn_id}")
async def update_transaction(
    txn_id: str,
    body: dict[str, Any],
    current_user: str = Depends(get_current_user),
) -> dict:
    """Update category / notes / tags for a single transaction. Marks it user_edited=True
    so resyncs never overwrite this row."""
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    if "txn_id" not in df.columns:
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, f"Transaction {txn_id} not found")

    reverse_map = {v: k for k, v in CAT_MAP.items()}
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

    # ── Auto-learn: apply same category to similar unedited transactions ──
    auto_applied = 0
    if "category" in body:
        source_desc = df.loc[mask, "description"].iloc[0]
        ll_cat      = body["category"]
        new_raw_cat = reverse_map.get(ll_cat, ll_cat)
        # Normalise description to a short fingerprint for fuzzy matching:
        # strip numbers/dates/IDs so "NETFLIX 1234" matches "NETFLIX 9999".
        def _fingerprint(s: str) -> str:
            s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
            s = re.sub(r"[^a-z ]+", " ", s)
            return " ".join(s.split()[:4])

        fp_source = _fingerprint(source_desc)
        if fp_source:
            not_approved = ~df["approved"].fillna(False).astype(bool) if "approved" in df.columns else pd.Series(True, index=df.index)
            unedited = ~(df.get("user_edited", False).fillna(False).astype(bool)) | mask
            similar_mask = df["description"].apply(_fingerprint) == fp_source
            apply_mask   = similar_mask & ~mask & unedited & not_approved
            if apply_mask.any():
                df.loc[apply_mask, "category"]    = new_raw_cat
                df.loc[apply_mask, "user_edited"] = True
                auto_applied = int(apply_mask.sum())

    save_df(current_user, df)
    return {"ok": True, "auto_applied": auto_applied}


@app.post("/api/transactions/{txn_id}/split")
async def split_transaction(
    txn_id: str,
    body: dict[str, Any],
    current_user: str = Depends(get_current_user),
) -> dict:
    """Split a transaction into multiple category/amount parts.
    Body: { splits: [{category, amount, notes?}, ...] }
    The amounts must sum to the original transaction amount (within $0.02).
    """
    splits = body.get("splits", [])
    if len(splits) < 2:
        raise HTTPException(400, "Need at least 2 splits")

    # Find the original transaction to validate amounts
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    if "txn_id" not in df.columns:
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, f"Transaction {txn_id} not found")

    original_amount = abs(float(df.loc[mask, "expense_amount"].iloc[0]))
    split_total = sum(abs(float(s["amount"])) for s in splits)
    if abs(split_total - original_amount) > 0.02:
        raise HTTPException(400, f"Split amounts ({split_total:.2f}) must equal transaction amount ({original_amount:.2f})")

    if not all(s.get("category") for s in splits):
        raise HTTPException(400, "Each split must have a category")

    # Store splits — amounts stored as negative (expense sign convention)
    normalized = [
        {
            "category": s["category"],
            "amount":   -abs(float(s["amount"])),
            "notes":    s.get("notes", ""),
        }
        for s in splits
    ]
    data = _load_splits(current_user)
    data[txn_id] = normalized
    _save_splits(current_user, data)
    return {"ok": True, "splits": len(normalized)}


@app.delete("/api/transactions/{txn_id}/split")
async def unsplit_transaction(
    txn_id: str,
    current_user: str = Depends(get_current_user),
) -> dict:
    """Remove splits for a transaction, restoring the original row."""
    data = _load_splits(current_user)
    if txn_id in data:
        del data[txn_id]
        _save_splits(current_user, data)
    return {"ok": True}


@app.post("/api/query")
async def run_query(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Run a read-only DuckDB SQL query against the user's transaction data.

    The view 'txns' is available with all transaction columns.
    Only SELECT statements are permitted.
    """
    sql = body.get("sql", "").strip()
    if not sql.upper().startswith("SELECT"):
        raise HTTPException(400, "Only SELECT queries are allowed")
    if not _data_file(current_user).exists():
        raise HTTPException(404, "No data")
    try:
        conn = _conn(current_user)
        result = conn.execute(sql).df()
        return {
            "columns": list(result.columns),
            "rows":    result.values.tolist(),
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/upload")
async def upload_csv(
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user),
) -> dict:
    """Accept a bank CSV, parse, categorize, deduplicate, and merge into storage."""
    import io
    import sys
    sys.path.insert(0, str(BASE_DIR))

    content = await file.read()
    try:
        raw_df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not read CSV: {e}")

    from parsers import detect_format, parse_chase_bank, parse_chase_cc, parse_amex, deduplicate
    fmt = detect_format(raw_df)
    if fmt == "chase_bank":
        parsed = parse_chase_bank(raw_df)
    elif fmt == "chase_cc":
        parsed = parse_chase_cc(raw_df)
    elif fmt == "amex":
        parsed = parse_amex(raw_df)
    else:
        raise HTTPException(400, f"Unrecognized CSV format. Columns: {list(raw_df.columns)}")

    parsed = parsed.dropna(subset=["date", "expense_amount"])
    if parsed.empty:
        raise HTTPException(400, "No valid transactions found in file")

    from categorizer.rules import categorize_transactions
    parsed = categorize_transactions(parsed)

    cfg = load_config(current_user)
    claude_key = cfg.get("anthropic_api_key", "")
    gemini_key = cfg.get("gemini_api_key", "")
    uncategorized = parsed[parsed["category"].isin(["Pending Review", "", None])]
    if not uncategorized.empty and (claude_key or gemini_key):
        try:
            from categorizer.llm import llm_categorize_all
            llm_categorize_all(parsed, anthropic_key=claude_key, gemini_key=gemini_key)
        except Exception:
            pass

    existing = load_df(current_user)
    if existing is not None:
        combined = pd.concat([existing, parsed], ignore_index=True)
    else:
        combined = parsed.copy()

    combined, dupes_removed = deduplicate(combined)
    save_df(current_user, combined)

    return {
        "ok":         True,
        "format":     fmt,
        "new":        len(parsed),
        "duplicates": dupes_removed,
        "total":      len(combined),
    }


def _build_schema(username: str) -> str:
    """Describe the txns table for the LLM — shape only, no actual row values."""
    conn = _conn(username)
    date_min, date_max = conn.execute("SELECT MIN(date), MAX(date) FROM txns").fetchone()
    total = conn.execute("SELECT COUNT(*) FROM txns").fetchone()[0]
    categories = [r[0] for r in conn.execute(
        "SELECT DISTINCT category FROM txns ORDER BY category"
    ).fetchall()]
    sources = [r[0] for r in conn.execute(
        "SELECT DISTINCT source FROM txns ORDER BY source"
    ).fetchall()]

    return f"""DuckDB view: txns  ({total} rows, {date_min} to {date_max})

Columns:
  date              DATE     — transaction date
  description       VARCHAR  — merchant or payee name
  expense_amount    DOUBLE   — positive = money spent, negative = income / credit
  transaction_type  VARCHAR  — 'expense' or 'income'
  category          VARCHAR  — one of: {', '.join(categories)}
  source            VARCHAR  — account name, one of: {', '.join(sources)}

Notes:
  - Use expense_amount > 0 to filter expenses, < 0 for income
  - All amounts are in USD
  - Date format is YYYY-MM-DD; use strftime(date, '%Y-%m') for month grouping
"""


def _llm_call(messages: list[dict], system: str, cfg: dict, max_tokens: int = 512) -> str:
    """Call whichever LLM is configured and return the text response."""
    preferred  = cfg.get("preferred_provider", "claude")
    claude_key = cfg.get("anthropic_api_key", "")
    gemini_key = cfg.get("gemini_api_key", "")
    providers  = ["claude", "gemini"] if preferred == "claude" else ["gemini", "claude"]

    for provider in providers:
        if provider == "claude" and claude_key:
            try:
                import anthropic
                resp = anthropic.Anthropic(api_key=claude_key).messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                )
                return resp.content[0].text
            except Exception:
                continue

        if provider == "gemini" and gemini_key:
            try:
                from google import genai
                from google.genai import types as gtypes
                client = genai.Client(api_key=gemini_key)
                gemini_msgs = [
                    gtypes.Content(role=m["role"], parts=[gtypes.Part(text=m["content"])])
                    for m in messages
                ]
                resp = client.models.generate_content(
                    model="gemini-2.5-flash-preview-04-17",
                    contents=gemini_msgs,
                    config=gtypes.GenerateContentConfig(system_instruction=system),
                )
                return resp.text
            except Exception:
                continue

    return ""


@app.post("/api/chat")
async def chat(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Privacy-preserving chat via text-to-SQL.

    Step 1: send schema (no data) to LLM → it writes a SELECT query
    Step 2: run that query locally with DuckDB
    Step 3: send only the result rows to LLM → it answers in plain English

    Raw transaction data never leaves the machine.
    """
    messages = body.get("messages", [])
    cfg      = load_config(current_user)

    if not cfg.get("anthropic_api_key") and not cfg.get("gemini_api_key"):
        return {"reply": "No AI provider configured. Add a Claude or Gemini API key in Settings."}

    if not _data_file(current_user).exists():
        return {"reply": "No transaction data found. Upload a CSV first."}

    schema = _build_schema(current_user)
    user_question = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )

    # Step 1: LLM writes the SQL query
    sql_system = f"""You are a DuckDB SQL expert for a personal finance app.
Write a single SELECT query that answers the user's question.
Return ONLY the raw SQL — no explanation, no markdown, no code fences.

{schema}"""

    raw_sql = _llm_call(messages, sql_system, cfg, max_tokens=256).strip()

    if raw_sql.startswith("```"):
        raw_sql = raw_sql.strip("`").lstrip("sql").strip()

    # Step 2: Run query locally with DuckDB
    sql_error = None
    result_text = ""
    row_count = 0
    try:
        conn = _conn(current_user)
        result_df = conn.execute(raw_sql).df()
        row_count = len(result_df)
        result_text = result_df.to_string(index=False, max_rows=50)
    except Exception as e:
        sql_error = str(e)
        result_text = f"Query failed: {sql_error}"

    # Step 3: LLM interprets the results
    interpret_system = (
        "You are a personal finance assistant. "
        "Answer the user's question based only on the SQL query results provided. "
        "Be concise and specific. Use $ for dollar amounts. "
        "If the query failed or returned no rows, say so clearly."
    )
    interpret_messages = [{
        "role": "user",
        "content": (
            f"Question: {user_question}\n\n"
            f"SQL run locally:\n{raw_sql}\n\n"
            f"Results ({row_count} rows):\n{result_text}"
        ),
    }]

    answer = _llm_call(interpret_messages, interpret_system, cfg, max_tokens=512)
    if not answer:
        answer = "Could not get a response from the AI provider."

    return {"reply": answer, "sql": raw_sql, "rows": row_count}


# ---------------------------------------------------------------------------
# Data repair + Plaid routes
# ---------------------------------------------------------------------------

@app.post("/api/repair")
async def repair_data(current_user: str = Depends(get_current_user)) -> dict:
    """One-shot data repair triggered from the Settings tab.

    Fixes three common issues:
    - Columns that became integers after a bad pandas concat (type fix)
    - Rows missing transaction_type (derived from expense_amount sign)
    - Rows still marked "Pending Review" (sent to LLM for categorization)

    Skips any row where user_edited=True.
    """
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    for col in ["transaction_type", "notes", "tags", "txn_id", "merchant"]:
        if col in df.columns:
            df[col] = df[col].astype(object).where(df[col].notna(), None)
            df[col] = df[col].apply(lambda v: str(v) if v not in (None, "None", "nan") else None)

    if "transaction_type" not in df.columns:
        df["transaction_type"] = None
    mask_missing = df["transaction_type"].isna() | (df["transaction_type"] == "None")
    df.loc[mask_missing & (df["expense_amount"] < 0), "transaction_type"] = "income"
    df.loc[mask_missing & (df["expense_amount"] >= 0), "transaction_type"] = "expense"

    for col in ["notes", "tags"]:
        if col not in df.columns or df[col].isna().all():
            df[col] = ""
        df[col] = df[col].fillna("")

    if "txn_id" not in df.columns or df["txn_id"].isna().all():
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    user_edited_mask = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    pending = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
    pending_count = int(pending.sum())

    llm_done = 0
    cfg = load_config(current_user)
    if pending_count > 0 and (cfg.get("anthropic_api_key") or cfg.get("gemini_api_key")):
        try:
            from categorizer.llm import llm_categorize_all
            pending_mask = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
            pending_df = df[pending_mask]
            descs = pending_df["description"].tolist()
            types = pending_df["transaction_type"].fillna("expense").tolist()

            provider = cfg.get("preferred_provider", "claude")
            api_key  = cfg.get("anthropic_api_key") if provider == "claude" else cfg.get("gemini_api_key")
            if not api_key:
                provider = "gemini" if provider == "claude" else "claude"
                api_key  = cfg.get("gemini_api_key") or cfg.get("anthropic_api_key")

            categories, err = llm_categorize_all(descs, api_key=api_key,
                                                  provider=provider, transaction_types=types)
            if categories:
                df.loc[pending_mask, "category"] = categories
                still_pending = df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()
                llm_done = pending_count - int(still_pending.sum())
        except Exception:
            pass

    save_df(current_user, df)
    return {
        "ok": True,
        "total": len(df),
        "type_fixed": int(mask_missing.sum()),
        "pending_before": pending_count,
        "llm_categorized": llm_done,
    }


@app.post("/api/plaid/link-token")
async def plaid_link_token(current_user: str = Depends(get_current_user)) -> dict:
    """Create a Plaid link_token to initialise the Link widget."""
    cfg = load_config(current_user)
    if not cfg.get("plaid_client_id") or not cfg.get("plaid_secret"):
        raise HTTPException(400, "Plaid keys not configured — add them in Settings")
    try:
        import sys; sys.path.insert(0, str(BASE_DIR))
        from plaid_client import create_link_token
        return {"link_token": create_link_token(cfg=cfg)}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/plaid/exchange")
async def plaid_exchange(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Exchange a one-time public_token for a stored access_token."""
    try:
        from plaid_client import exchange_and_save
        exchange_and_save(
            body["public_token"],
            body.get("institution_name", "Unknown"),
            cfg=load_config(current_user),
            data_dir=str(_user_dir(current_user)),
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/plaid/accounts")
def plaid_accounts(current_user: str = Depends(get_current_user)) -> dict:
    """List connected Plaid institutions for this user."""
    try:
        from plaid_client import get_connected_accounts, is_configured
        cfg = load_config(current_user)
        data_dir = str(_user_dir(current_user))
        return {
            "configured": is_configured(cfg),
            "accounts":   get_connected_accounts(data_dir=data_dir),
        }
    except Exception as e:
        return {"configured": False, "accounts": [], "error": str(e)}


@app.post("/api/plaid/sync")
async def plaid_sync(body: dict[str, Any] = {}, current_user: str = Depends(get_current_user)) -> dict:
    """Pull new transactions from all linked banks.

    Normal sync: only fetches changes since the last cursor (fast, incremental).
    Full re-sync {"full": true}: resets all cursors so the full history is
    re-pulled from Plaid — user_edited categories are preserved by plaid_client.py.
    """
    try:
        from plaid_client import sync_all_transactions, refresh_all, _load_items, _save_items
        from categorizer.rules import categorize_transactions

        cfg      = load_config(current_user)
        data_dir = str(_user_dir(current_user))

        if body.get("full"):
            items = _load_items(data_dir=data_dir)
            for item in items:
                item["cursor"] = None
            _save_items(items, data_dir=data_dir)

        refresh_all(cfg=cfg, data_dir=data_dir)
        existing = load_df(current_user)
        df, errors, stats = sync_all_transactions(existing, cfg=cfg, data_dir=data_dir)
        if stats["added"] > 0:
            df = categorize_transactions(df)
            if "transaction_type" not in df.columns:
                df["transaction_type"] = None
            mask = df["transaction_type"].isna() | (df["transaction_type"].astype(str) == "None")
            df.loc[mask & (df["expense_amount"] >= 0), "transaction_type"] = "expense"
            df.loc[mask & (df["expense_amount"] < 0),  "transaction_type"] = "income"
            save_df(current_user, df)
        # Save last sync timestamp
        cfg2 = load_config(current_user)
        cfg2["last_sync"] = datetime.datetime.utcnow().isoformat() + "Z"
        save_config(current_user, cfg2)
        return {"ok": True, "stats": stats, "errors": errors, "last_sync": cfg2["last_sync"]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/plaid/sync_status")
def plaid_sync_status(current_user: str = Depends(get_current_user)) -> dict:
    """Return last sync time and whether auto-sync is needed (>48h since last sync)."""
    cfg = load_config(current_user)
    last_sync = cfg.get("last_sync")
    needs_sync = True
    if last_sync:
        try:
            last_dt = datetime.datetime.fromisoformat(last_sync.replace("Z", ""))
            needs_sync = (datetime.datetime.utcnow() - last_dt).total_seconds() > 48 * 3600
        except Exception:
            pass
    return {"last_sync": last_sync, "needs_sync": needs_sync}


@app.delete("/api/plaid/accounts/{item_id}")
async def plaid_remove_account(item_id: str, current_user: str = Depends(get_current_user)) -> dict:
    """Unlink a Plaid institution by item_id."""
    try:
        from plaid_client import remove_account
        remove_account(item_id, data_dir=str(_user_dir(current_user)))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

FEEDBACK_FILE = DATA_DIR / "feedback.json"

def _load_feedback() -> list:
    if FEEDBACK_FILE.exists():
        return json.loads(FEEDBACK_FILE.read_text())
    return []

def _save_feedback(entries: list) -> None:
    FEEDBACK_FILE.write_text(json.dumps(entries, indent=2))

@app.post("/api/feedback")
async def submit_feedback(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message required")
    users = json.loads(USERS_FILE.read_text()) if USERS_FILE.exists() else {}
    display_name = users.get(current_user, {}).get("display_name") or current_user
    entry = {
        "id":           secrets.token_hex(6),
        "username":     current_user,
        "display_name": display_name,
        "category":     body.get("category") or "general",
        "message":      message,
        "timestamp":    datetime.datetime.utcnow().isoformat() + "Z",
    }
    entries = _load_feedback()
    entries.append(entry)
    _save_feedback(entries)
    return {"ok": True}

@app.get("/api/feedback")
def get_feedback(current_user: str = Depends(get_current_user)) -> dict:
    users = json.loads(USERS_FILE.read_text()) if USERS_FILE.exists() else {}
    is_admin = users.get(current_user, {}).get("is_admin", False)
    entries = _load_feedback()
    if not is_admin:
        entries = [e for e in entries if e.get("username") == current_user]
    return {"entries": entries, "is_admin": is_admin}


# ---------------------------------------------------------------------------
# Serve the React frontend — must be last so /api/* routes take priority.
#
# Auth rules:
#   /login        — always public (the login page itself)
#   /*.js/jsx/css — always served (static assets; API 401s handle the rest)
#   everything else — redirect to /login if no valid session
# ---------------------------------------------------------------------------

@app.get("/login")
def serve_login() -> FileResponse:
    return FileResponse(LL_DIR / "login.html")


@app.get("/{filename:path}")
def serve_frontend(filename: str = "", request: Request = None) -> Response:
    path = LL_DIR / filename if filename else LL_DIR / "index.html"

    # Require auth for HTML page requests; static assets (js/css/jsx) are open
    is_asset = path.suffix in (".js", ".jsx", ".css", ".png", ".ico", ".svg", ".woff", ".woff2")
    if not is_asset:
        token   = request.cookies.get(SESSION_COOKIE) if request else None
        session = _sessions.get(token) if token else None
        if not session or datetime.datetime.utcnow() > session.get("expires", datetime.datetime.min):
            return RedirectResponse("/login")

    # For .jsx requests, serve the pre-compiled .js.compiled file (auto-recompile if stale)
    if path.suffix == ".jsx" and path.name in JSX_FILES:
        try:
            compiled = _ensure_compiled(path.name)
            resp = FileResponse(compiled, media_type="application/javascript")
            resp.headers["Cache-Control"] = "no-store"
            return resp
        except Exception as e:
            print(f"Compile error for {path.name}: {e}")
            # Fall through to serve raw JSX as fallback

    if not path.exists() or not path.is_file():
        path = LL_DIR / "index.html"

    resp = FileResponse(path)
    if path.suffix in (".js", ".jsx", ".css"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Starting MoneyTalks at http://localhost:8502")
    uvicorn.run(app, host="0.0.0.0", port=8502, log_level="info")
