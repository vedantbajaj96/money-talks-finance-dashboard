"""
categorizer/rules.py — Keyword-based transaction categorization.

Two entry points:
  categorize(description)        — for expense transactions (expense_amount > 0)
  categorize_income(description) — for income transactions (expense_amount < 0)

Both return a (category, suggested_category) tuple. If a keyword match is found,
suggested_category is None. If no match, category is "Pending Review" and
suggested_category is a best-guess pre-fill for the Sanity Check UI.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pandas as pd

from .constants import (
    ALL_CATEGORIES,
    CATEGORY_KEYWORDS,
    INCOME_CATEGORIES,
    INCOME_KEYWORDS,
)


# ---------------------------------------------------------------------------
# Expense categorization
# ---------------------------------------------------------------------------

def suggest_category(description: str) -> str:
    """
    Broad heuristic guess for an unmatched expense transaction.
    Used only to pre-fill the Sanity Check dropdown — not meant to be accurate.
    """
    desc = description.lower()

    if any(w in desc for w in ["transfer", "payment", "deposit", "fee", "tax", "invest"]):
        return "Financial & Transfers"
    if any(w in desc for w in ["delivery", "doordash", "grubhub", "ubereats"]):
        return "Food Delivery"
    if any(w in desc for w in ["hotel", "flight", "airline", "airbnb", "travel"]):
        return "Travel & Getaways"
    if any(w in desc for w in ["grocery", "grocer", "supermarket", "market"]):
        return "Groceries"
    if any(w in desc for w in ["restaurant", "cafe", "bar", "food", "eat", "drink", "coffee", "pizza"]):
        return "Dining & Drinks"
    if any(w in desc for w in ["gym", "fitness", "yoga", "pilates", "sport", "active", "workout"]):
        return "Fitness & Active"
    if any(w in desc for w in ["health", "medical", "clinic", "pharma", "therapy", "doctor"]):
        return "Health & Medical"
    if any(w in desc for w in ["rent", "utility", "electric", "water", "gas bill"]):
        return "Housing & Utilities"
    if any(w in desc for w in ["phone", "internet", "mobile", "wireless", "cloud"]):
        return "Connectivity"
    if any(w in desc for w in ["parking", "transit", "uber", "lyft", "gas station", "fuel"]):
        return "Commute & Transport"
    if any(w in desc for w in ["course", "book", "school", "university", "learn", "certif"]):
        return "Professional Development"
    if any(w in desc for w in ["stream", "subscription", "monthly", "annual", "app "]):
        return "Entertainment"

    return "Shopping & Retail"


def categorize(description: str) -> tuple[str, str | None]:
    """
    Return (category, suggested_category) for an expense transaction.

    Iterates ALL_CATEGORIES in priority order and returns the first match.
    If nothing matches, returns ("Pending Review", <heuristic guess>).
    """
    desc_lower = str(description).lower()

    for category in ALL_CATEGORIES:
        if any(kw in desc_lower for kw in CATEGORY_KEYWORDS[category]):
            return (category, None)

    return ("Pending Review", suggest_category(description))


# ---------------------------------------------------------------------------
# Income categorization
# ---------------------------------------------------------------------------

def suggest_income_category(description: str) -> str:
    """
    Broad heuristic guess for an unmatched income transaction.
    Used only to pre-fill the Sanity Check dropdown.
    """
    desc = description.lower()

    if any(w in desc for w in ["payroll", "salary", "deposit", "employer", "wages"]):
        return "Paycheck & Salary"
    if any(w in desc for w in ["refund", "cashback", "reimbursement", "credit"]):
        return "Reimbursements"
    if any(w in desc for w in ["dividend", "interest", "investment", "brokerage"]):
        return "Investment & Dividend Income"
    if any(w in desc for w in ["freelance", "consulting", "stripe", "venmo", "paypal", "zelle"]):
        return "Freelance & Side Income"

    return "Other Income"


def categorize_income(description: str) -> tuple[str, str | None]:
    """
    Return (category, suggested_category) for an income transaction.

    Checks INCOME_KEYWORDS in priority order. "Financial & Transfers" is first
    so pure account transfers on the income side are still filtered out.
    If nothing matches, returns ("Pending Review", <heuristic guess>).
    """
    desc_lower = str(description).lower()

    income_priority = [
        "Financial & Transfers",
        "Paycheck & Salary",
        "Freelance & Side Income",
        "Investment & Dividend Income",
        "Reimbursements",
        "Other Income",
    ]

    for category in income_priority:
        keywords = INCOME_KEYWORDS.get(category, [])
        if keywords and any(kw in desc_lower for kw in keywords):
            return (category, None)

    return ("Pending Review", suggest_income_category(description))


# ---------------------------------------------------------------------------
# DataFrame-level entry point
# ---------------------------------------------------------------------------

def _load_apply_rules(user_rules_path: Path | None = None):
    """Load apply_rules from user-specific file, falling back to repo template."""
    _ROOT = Path(__file__).parent.parent

    candidates = []
    if user_rules_path is not None:
        candidates.append(user_rules_path)
    candidates.append(_ROOT / "user_rules.py")  # repo template fallback

    for path in candidates:
        if path.exists():
            spec = importlib.util.spec_from_file_location("user_rules", path)
            mod  = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, "apply_rules", lambda desc, amount=0.0: None)

    return lambda desc, amount=0.0: None


def categorize_transactions(df: pd.DataFrame, user_rules_path: Path | None = None) -> pd.DataFrame:
    """
    Add 'category' and 'suggested_category' columns to a transactions DataFrame.

    Priority order:
      1. User-defined rules (data/<username>/user_rules.py) — highest priority
         Falls back to the repo-level user_rules.py template if not found.
      2. Income keyword matching for negative amounts
      3. Expense keyword matching for positive amounts

    Returns a copy of df with the two new columns.
    """
    apply_rules = _load_apply_rules(user_rules_path)

    df = df.copy()

    def _categorize_row(row):
        rule_cat = apply_rules(row["description"], float(row.get("expense_amount", 0)))
        if rule_cat is not None:
            return (rule_cat, None)
        if row["expense_amount"] < 0:
            return categorize_income(row["description"])
        return categorize(row["description"])

    results = df.apply(_categorize_row, axis=1)
    df["category"] = results.apply(lambda t: t[0])
    df["suggested_category"] = results.apply(lambda t: t[1])

    return df
