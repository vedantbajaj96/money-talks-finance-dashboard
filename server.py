"""
server.py — FastAPI backend for the MoneyTalks dashboard.

How it fits together
--------------------
The React frontend (ledgerline/) loads once and calls /api/fin to get all data.
Everything else is mutation: uploading CSVs, editing transactions, syncing Plaid.

Data flow:
  CSV upload  →  parsers.py  →  categorizer/  →  transactions.parquet
  Plaid sync  →  plaid_client.py              →  transactions.parquet
  /api/fin    →  DuckDB reads parquet          →  JSON to frontend

Read strategy: DuckDB queries the parquet file directly — fast, no full load.
Write strategy: pandas reads, mutates, and saves back — simpler for row edits.

Run:
    python3 server.py
"""

from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR    = Path(__file__).parent
DATA_FILE   = BASE_DIR / "data" / "transactions.parquet"
CONFIG_FILE = BASE_DIR / "config.json"
LL_DIR      = BASE_DIR / "ledgerline"

app = FastAPI(title="MoneyTalks API")

# ---------------------------------------------------------------------------
# Category mapping
#
# The categorizer stores human-readable names in the parquet ("Dining & Drinks").
# The frontend uses short IDs ("dining"). CAT_MAP bridges the two.
#
# Three sets of keys cover every variant we might see in stored data:
#   1. Categorizer display names  ("Dining & Drinks")
#   2. Slugified versions          ("dining-and-drinks")  — older rows
#   3. Legacy Streamlit names      ("Food & Drink")        — oldest rows
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
    "Professional Development":     "other",
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
    "professional-development":       "other",
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
    "income":        {"name": "Income",          "group": "income",   "color": "#5ec98a", "icon": "↗"},
    "rent":          {"name": "Rent & Housing",  "group": "fixed",    "color": "#6b8aab", "icon": "◧"},
    "groceries":     {"name": "Groceries",       "group": "variable", "color": "#a3e635", "icon": "◉"},
    "dining":        {"name": "Dining & Bars",   "group": "variable", "color": "#d97757", "icon": "◔"},
    "transport":     {"name": "Transport",       "group": "variable", "color": "#67e8f9", "icon": "◇"},
    "utilities":     {"name": "Utilities",       "group": "fixed",    "color": "#fbbf24", "icon": "◐"},
    "subs":          {"name": "Subscriptions",   "group": "fixed",    "color": "#a78bfa", "icon": "◑"},
    "shopping":      {"name": "Shopping",        "group": "variable", "color": "#ec4899", "icon": "◕"},
    "health":        {"name": "Health & Fitness","group": "variable", "color": "#22d3ee", "icon": "◙"},
    "travel":        {"name": "Travel",          "group": "variable", "color": "#f97316", "icon": "◭"},
    "entertainment": {"name": "Entertainment",   "group": "variable", "color": "#e879f9", "icon": "◬"},
    "transfer":      {"name": "Transfers",       "group": "transfer", "color": "#64748b", "icon": "⇄"},
    "savings":       {"name": "Savings",         "group": "transfer", "color": "#34d399", "icon": "⊕"},
    "other":         {"name": "Other",           "group": "variable", "color": "#94a3b8", "icon": "○"},
}

ACCOUNT_COLORS = ["#5ec98a", "#67e8f9", "#d97757", "#a78bfa", "#fbbf24", "#6b8aab", "#f97316", "#e879f9"]


# Substrings in the description that always mean "transfer", regardless of what
# the categorizer said. Credit card autopayments often get tagged "Other Income"
# by the LLM — this catches them first.
_TRANSFER_DESC_PATTERNS = [
    "automatic payment",
    "payment - thank",
    "payment thank you",
    "acctverify",
    "penny test",
    "account transfer",
    "ach transfer",
]

# Reimbursements are stored as "other" — they're not real income or expenses.
_REIMBURSEMENT_CATS = {"reimbursements", "Reimbursements"}


def map_category(cat: str) -> str:
    if cat in CAT_MAP:
        return CAT_MAP[cat]
    return cat.lower().replace(" ", "-").replace("&", "and")


def _resolve_category(description: str, raw_category: str, txn_type: str | None, expense_amount: float = 0.0) -> str:
    """Map a raw parquet category to a frontend category ID.

    Called for every transaction in build_fin_data(). Priority order:
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

    # Derive income/expense from amount when transaction_type is missing
    is_income = (txn_type == "income") or (txn_type is None and expense_amount < 0)
    if is_income:
        return "income"

    return cat_id


# ---------------------------------------------------------------------------
# DuckDB helpers
#
# We open a fresh in-memory connection for every request — cheap because DuckDB
# reads directly from the parquet file without loading it all into RAM.
# ---------------------------------------------------------------------------

def _conn() -> duckdb.DuckDBPyConnection:
    """Return a DuckDB connection with the parquet file registered as 'txns'."""
    c = duckdb.connect()
    path = str(DATA_FILE).replace("'", "''")
    c.execute(f"CREATE VIEW txns AS SELECT * FROM read_parquet('{path}')")
    return c


def _month_labels(key: str) -> tuple[str, str, str]:
    """'2024-03' → ('Mar 2024', 'Mar', 'Mar 24')"""
    dt = datetime.date(int(key[:4]), int(key[5:7]), 1)
    return dt.strftime("%b %Y"), dt.strftime("%b"), dt.strftime("%b %y")


# ---------------------------------------------------------------------------
# Config helpers  (config.json stores API keys — gitignored)
# ---------------------------------------------------------------------------

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    try:
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Pandas helpers  (only used for writes — reads go through DuckDB)
# ---------------------------------------------------------------------------

def load_df() -> pd.DataFrame | None:
    if not DATA_FILE.exists():
        return None
    try:
        df = pd.read_parquet(DATA_FILE)
        return df if not df.empty else None
    except Exception:
        return None


def save_df(df: pd.DataFrame) -> None:
    DATA_FILE.parent.mkdir(exist_ok=True)
    df.to_parquet(DATA_FILE, index=False)


# ---------------------------------------------------------------------------
# build_fin_data  — the heart of /api/fin
#
# Queries the parquet file with DuckDB and assembles the JSON object the
# React frontend consumes. Called once per page load; everything the UI
# needs (transactions, accounts, categories, recurring, net worth) is here.
# ---------------------------------------------------------------------------

def build_fin_data() -> dict:
    conn = _conn()

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
        from plaid_client import get_account_balances, is_configured
        if is_configured():
            for b in get_account_balances():
                inst = b["institution_name"]
                key  = f"Plaid – {inst}"
                # Aggregate balances per institution (sum sub-accounts)
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
    seen_cat_ids: set[str] = {"income"}  # always include income
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
    categories = [{"id": k, **v} for k, v in all_meta.items() if k in seen_cat_ids]

    # ── TRANSACTIONS ──────────────────────────────────────────────────────
    # Check which optional columns exist
    col_names = {r[0] for r in conn.execute("DESCRIBE txns").fetchall()}
    select_txn_id = "txn_id" if "txn_id" in col_names else "NULL"
    select_notes  = "notes"  if "notes"  in col_names else "NULL"
    select_tags   = "tags"   if "tags"   in col_names else "NULL"

    transactions = []
    # Fetch transaction_type if available (used to reliably identify income)
    has_txn_type = "transaction_type" in col_names
    select_txn_type = "transaction_type" if has_txn_type else "NULL"

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
            "amount":   round(-float(expense_amount), 2),  # flip: expense→negative, income→positive
            "account":  str(source or ""),
            "pending":  False,
            "notes":    str(notes or ""),
            "tags":     str(tags or ""),
        })

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
        import sys
        sys.path.insert(0, str(BASE_DIR))
        from subscriptions import detect_recurring
        df = pd.read_parquet(DATA_FILE)
        rec_df = detect_recurring(df)
        if not rec_df.empty:
            for _, row in rec_df.iterrows():
                cat_id = map_category(str(row.get("category", "other")))
                matches = df[df["description"] == row["description"]]
                recurring.append({
                    "merchant": str(row["description"]),
                    "category": cat_id,
                    "amount":   float(row["amount"]),
                    "freq":     str(row.get("frequency", "monthly")),
                    "account":  str(matches["source"].iloc[0]) if not matches.empty else "",
                    "next":     "",
                    "day":      1,
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


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/fin")
def get_fin() -> dict:
    """Main data endpoint — called once on page load by data.js."""
    if not DATA_FILE.exists():
        return {"hasData": False}
    try:
        return build_fin_data()
    except Exception:
        return {"hasData": False}


@app.get("/api/config")
def get_config() -> dict:
    cfg = load_config()
    return {
        "has_anthropic":      bool(cfg.get("anthropic_api_key")),
        "has_gemini":         bool(cfg.get("gemini_api_key")),
        "preferred_provider": cfg.get("preferred_provider", "claude"),
        "has_plaid":          bool(cfg.get("plaid_client_id") and cfg.get("plaid_secret")),
    }


@app.post("/api/config")
async def update_config(body: dict[str, Any]) -> dict:
    cfg = load_config()
    allowed = {"anthropic_api_key", "gemini_api_key", "preferred_provider",
               "plaid_client_id", "plaid_secret", "plaid_environment"}
    for k, v in body.items():
        if k in allowed:
            cfg[k] = v
    save_config(cfg)
    return {"ok": True}


@app.patch("/api/transactions/{txn_id}")
async def update_transaction(txn_id: str, body: dict[str, Any]) -> dict:
    """Update category / notes / tags for a single transaction."""
    df = load_df()
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

    # Mark as user-edited so resyncs never overwrite this row
    if "user_edited" not in df.columns:
        df["user_edited"] = False
    df.loc[mask, "user_edited"] = True

    save_df(df)
    return {"ok": True}


@app.post("/api/query")
async def run_query(body: dict[str, Any]) -> dict:
    """Run a read-only DuckDB SQL query against transaction data.

    The view 'txns' is available with all transaction columns.
    Only SELECT statements are permitted.
    """
    sql = body.get("sql", "").strip()
    if not sql.upper().startswith("SELECT"):
        raise HTTPException(400, "Only SELECT queries are allowed")
    if not DATA_FILE.exists():
        raise HTTPException(404, "No data")
    try:
        conn = _conn()
        result = conn.execute(sql).df()
        return {
            "columns": list(result.columns),
            "rows":    result.values.tolist(),
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)) -> dict:
    """Accept a bank CSV, parse, categorize, deduplicate, and merge into storage."""
    import io
    import sys
    sys.path.insert(0, str(BASE_DIR))

    # Read uploaded bytes
    content = await file.read()
    try:
        raw_df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not read CSV: {e}")

    # Parse
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

    # Rule-based categorization first (fast, no API call)
    from categorizer.rules import categorize_transactions
    parsed = categorize_transactions(parsed)

    # LLM categorization for anything still uncategorized / pending review
    cfg = load_config()
    claude_key  = cfg.get("anthropic_api_key", "")
    gemini_key  = cfg.get("gemini_api_key", "")
    uncategorized = parsed[parsed["category"].isin(["Pending Review", "", None])]
    if not uncategorized.empty and (claude_key or gemini_key):
        try:
            from categorizer.llm import llm_categorize_all
            llm_categorize_all(parsed, anthropic_key=claude_key, gemini_key=gemini_key)
        except Exception:
            pass  # fall back to rule-based results

    # Merge with existing data, deduplicate
    existing = load_df()
    if existing is not None:
        combined = pd.concat([existing, parsed], ignore_index=True)
    else:
        combined = parsed.copy()

    combined, dupes_removed = deduplicate(combined)
    save_df(combined)

    new_rows = len(parsed)
    total    = len(combined)
    return {
        "ok":            True,
        "format":        fmt,
        "new":           new_rows,
        "duplicates":    dupes_removed,
        "total":         total,
    }


def _build_schema() -> str:
    """Describe the txns table for the LLM — shape only, no actual row values."""
    conn = _conn()
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
async def chat(body: dict[str, Any]) -> dict:
    """Privacy-preserving chat via text-to-SQL.

    Step 1: send schema (no data) to LLM → it writes a SELECT query
    Step 2: run that query locally with DuckDB
    Step 3: send only the result rows to LLM → it answers in plain English

    Raw transaction data never leaves the machine.
    """
    messages = body.get("messages", [])
    cfg      = load_config()

    if not cfg.get("anthropic_api_key") and not cfg.get("gemini_api_key"):
        return {"reply": "No AI provider configured. Add a Claude or Gemini API key in Settings."}

    if not DATA_FILE.exists():
        return {"reply": "No transaction data found. Upload a CSV first."}

    schema = _build_schema()
    user_question = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
    )

    # ── Step 1: LLM writes the SQL query ──────────────────────────────────
    sql_system = f"""You are a DuckDB SQL expert for a personal finance app.
Write a single SELECT query that answers the user's question.
Return ONLY the raw SQL — no explanation, no markdown, no code fences.

{schema}"""

    raw_sql = _llm_call(messages, sql_system, cfg, max_tokens=256).strip()

    # Strip accidental markdown fences
    if raw_sql.startswith("```"):
        raw_sql = raw_sql.strip("`").lstrip("sql").strip()

    # ── Step 2: Run query locally with DuckDB ─────────────────────────────
    sql_error = None
    result_text = ""
    row_count = 0
    try:
        conn = _conn()
        result_df = conn.execute(raw_sql).df()
        row_count = len(result_df)
        result_text = result_df.to_string(index=False, max_rows=50)
    except Exception as e:
        sql_error = str(e)
        result_text = f"Query failed: {sql_error}"

    # ── Step 3: LLM interprets the results ────────────────────────────────
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

    return {
        "reply": answer,
        "sql":   raw_sql,
        "rows":  row_count,
    }


# ---------------------------------------------------------------------------
# Data repair + Plaid routes
# ---------------------------------------------------------------------------

@app.post("/api/repair")
async def repair_data() -> dict:
    """One-shot data repair triggered from the Settings tab.

    Fixes three common issues:
    - Columns that became integers after a bad pandas concat (type fix)
    - Rows missing transaction_type (derived from expense_amount sign)
    - Rows still marked "Pending Review" (sent to LLM for categorization)

    Skips any row where user_edited=True.
    """
    df = load_df()
    if df is None:
        raise HTTPException(404, "No data")

    # Fix column types — these end up as integer NaN columns when rows are missing the field
    for col in ["transaction_type", "notes", "tags", "txn_id", "merchant"]:
        if col in df.columns:
            df[col] = df[col].astype(object).where(df[col].notna(), None)
            df[col] = df[col].apply(lambda v: str(v) if v not in (None, "None", "nan") else None)

    # Derive transaction_type from expense_amount where missing
    if "transaction_type" not in df.columns:
        df["transaction_type"] = None
    mask_missing = df["transaction_type"].isna() | (df["transaction_type"] == "None")
    df.loc[mask_missing & (df["expense_amount"] < 0), "transaction_type"] = "income"
    df.loc[mask_missing & (df["expense_amount"] >= 0), "transaction_type"] = "expense"

    # Ensure required string columns exist
    for col in ["notes", "tags"]:
        if col not in df.columns or df[col].isna().all():
            df[col] = ""
        df[col] = df[col].fillna("")

    # Generate txn_id where missing
    if "txn_id" not in df.columns or df["txn_id"].isna().all():
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    # Never re-categorize user-edited rows
    user_edited_mask = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    pending = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
    pending_count = int(pending.sum())

    # Run LLM categorization on pending rows if API key available
    llm_done = 0
    cfg = load_config()
    if pending_count > 0 and (cfg.get("anthropic_api_key") or cfg.get("gemini_api_key")):
        try:
            from categorizer.llm import llm_categorize_all
            pending_mask = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
            pending_df = df[pending_mask]
            descs = pending_df["description"].tolist()
            types = pending_df["transaction_type"].fillna("expense").tolist()

            provider   = cfg.get("preferred_provider", "claude")
            api_key    = cfg.get("anthropic_api_key") if provider == "claude" else cfg.get("gemini_api_key")
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

    save_df(df)
    return {
        "ok": True,
        "total": len(df),
        "type_fixed": int(mask_missing.sum()),
        "pending_before": pending_count,
        "llm_categorized": llm_done,
    }


@app.post("/api/plaid/link-token")
async def plaid_link_token() -> dict:
    """Create a Plaid link_token to initialise the Link widget."""
    cfg = load_config()
    if not cfg.get("plaid_client_id") or not cfg.get("plaid_secret"):
        raise HTTPException(400, "Plaid keys not configured — add them in Settings")
    try:
        import sys; sys.path.insert(0, str(BASE_DIR))
        from plaid_client import create_link_token
        return {"link_token": create_link_token()}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/plaid/exchange")
async def plaid_exchange(body: dict[str, Any]) -> dict:
    """Exchange a one-time public_token for a stored access_token."""
    try:
        from plaid_client import exchange_and_save
        exchange_and_save(body["public_token"], body.get("institution_name", "Unknown"))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/plaid/accounts")
def plaid_accounts() -> dict:
    """List connected Plaid institutions."""
    try:
        from plaid_client import get_connected_accounts, is_configured
        return {"configured": is_configured(), "accounts": get_connected_accounts()}
    except Exception as e:
        return {"configured": False, "accounts": [], "error": str(e)}


@app.post("/api/plaid/sync")
async def plaid_sync(body: dict[str, Any] = {}) -> dict:
    """Pull new transactions from all linked banks.

    Normal sync: only fetches changes since the last cursor (fast, incremental).
    Full re-sync {"full": true}: resets all cursors so the full history is
    re-pulled from Plaid — user_edited categories are preserved by plaid_client.py.
    """
    try:
        from plaid_client import sync_all_transactions, refresh_all, _load_items, _save_items
        from categorizer.rules import categorize_transactions

        if body.get("full"):
            items = _load_items()
            for item in items:
                item["cursor"] = None
            _save_items(items)

        refresh_all()
        existing = load_df()
        df, errors, stats = sync_all_transactions(existing)
        if stats["added"] > 0:
            df = categorize_transactions(df)
            # Derive transaction_type from amount sign for rows missing it
            # (Plaid: positive expense_amount = money out = expense)
            if "transaction_type" not in df.columns:
                df["transaction_type"] = None
            mask = df["transaction_type"].isna() | (df["transaction_type"].astype(str) == "None")
            df.loc[mask & (df["expense_amount"] >= 0), "transaction_type"] = "expense"
            df.loc[mask & (df["expense_amount"] < 0),  "transaction_type"] = "income"
            save_df(df)
        return {"ok": True, "stats": stats, "errors": errors}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/plaid/accounts/{item_id}")
async def plaid_remove_account(item_id: str) -> dict:
    """Unlink a Plaid institution by item_id."""
    try:
        from plaid_client import remove_account
        remove_account(item_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Serve the React frontend as static files — must be last so /api/* routes
# are registered before the catch-all StaticFiles handler.
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=str(LL_DIR), html=True), name="static")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Starting MoneyTalks at http://localhost:8502")
    uvicorn.run(app, host="0.0.0.0", port=8502, log_level="info")
