"""
core/categories.py — Category constants and pure classification helpers.

map_category() and _resolve_category() are pure functions with no side effects.
They can be imported and tested without any I/O.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Category mapping: raw parquet value → frontend short ID
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
    "Personal Care":                "personal_care",
    "Grooming & Beauty":            "personal_care",
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
    "personal-care":                  "personal_care",
    "grooming-and-beauty":            "personal_care",
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

# Reverse map: frontend ID → a parquet-compatible name for storage.
# CAT_MAP is many-to-one so only the last mapping survives per value.
CAT_REVERSE_MAP: dict[str, str] = {v: k for k, v in CAT_MAP.items()}

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
    "refund":        {"name": "Refund / Return",  "group": "transfer", "color": "#94a3b8", "icon": "↩"},
    "savings":       {"name": "Savings",          "group": "transfer", "color": "#34d399", "icon": "⊕"},
    "education":     {"name": "Education",        "group": "variable", "color": "#818cf8", "icon": "◈"},
    "self_dev":      {"name": "Self Development", "group": "variable", "color": "#fb7185", "icon": "◍"},
    "personal_care": {"name": "Personal Care",    "group": "variable", "color": "#f0abfc", "icon": "◎"},
    "other":         {"name": "Other",            "group": "variable", "color": "#94a3b8", "icon": "○"},
}

ACCOUNT_COLORS = ["#5ec98a", "#67e8f9", "#d97757", "#a78bfa", "#fbbf24", "#6b8aab", "#f97316", "#e879f9"]

# Description substrings that always map to "transfer" regardless of categoriser output.
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


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def map_category(cat: str) -> str:
    if cat in CAT_MAP:
        return CAT_MAP[cat]
    return cat.lower().replace(" ", "-").replace("&", "and")


def _resolve_category(
    description: str,
    raw_category: str,
    txn_type: str | None,
    expense_amount: float = 0.0,
) -> str:
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


def detect_refund_pairs(df: "pd.DataFrame") -> "tuple[pd.DataFrame, int]":
    """Auto-categorize matched charge/refund pairs as 'refund'.

    A pair matches when:
      - Same description (case-insensitive)
      - Same absolute amount (within $0.01)
      - The credit arrives within 90 days of the charge
      - Neither transaction has been manually edited

    Returns (modified_df, number_of_pairs_found).
    """
    import pandas as pd

    if df.empty or "expense_amount" not in df.columns:
        return df, 0

    user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    editable    = ~user_edited
    dates       = pd.to_datetime(df["date"])
    descs       = df["description"].astype(str).str.strip().str.lower()
    amounts     = df["expense_amount"].astype(float)

    charge_idx = list(df.index[editable & (amounts > 0)])
    credit_idx = list(df.index[editable & (amounts < 0)])

    matched    = set()
    pair_count = 0

    for ci in credit_idx:
        if ci in matched:
            continue
        credit_amt  = abs(amounts[ci])
        credit_date = dates[ci]
        credit_desc = descs[ci]

        for di in charge_idx:
            if di in matched:
                continue
            if abs(amounts[di] - credit_amt) > 0.01:
                continue
            if descs[di] != credit_desc:
                continue
            days_diff = (credit_date - dates[di]).days
            if 0 <= days_diff <= 90:
                matched.add(ci)
                matched.add(di)
                pair_count += 1
                break

    if matched:
        df = df.copy()
        df.loc[list(matched), "category"]    = "Refund / Return"
        df.loc[list(matched), "user_edited"] = True

    return df, pair_count


def description_fingerprint(s: str) -> str:
    """Normalise a merchant description for fuzzy matching.

    Strips numbers/dates/IDs so 'NETFLIX 1234' matches 'NETFLIX 9999'.
    """
    s = re.sub(r"\b\d[\d/\-]*\d\b", "", str(s).lower())
    s = re.sub(r"[^a-z ]+", " ", s)
    return " ".join(s.split()[:4])


def build_cat_list(cfg: dict) -> list:
    """Return the full ordered category list with user overrides applied."""
    custom    = {c["id"]: c for c in (cfg.get("custom_categories") or [])}
    overrides = cfg.get("category_overrides") or {}
    order     = cfg.get("category_order") or []
    hidden    = set(cfg.get("hidden_categories") or [])

    all_cats: dict[str, dict] = {}
    for kid, v in CAT_META.items():
        if kid in hidden:
            continue
        entry = {"id": kid, **v, "builtin": True}
        if kid in overrides:
            entry.update({k: v2 for k, v2 in overrides[kid].items() if k in ("name", "color")})
        all_cats[kid] = entry
    for cid, c in custom.items():
        if cid not in hidden:
            all_cats[cid] = {"builtin": False, **c}

    ordered = [all_cats[i] for i in order if i in all_cats]
    rest    = [all_cats[i] for i in all_cats if i not in order]
    return ordered + rest
