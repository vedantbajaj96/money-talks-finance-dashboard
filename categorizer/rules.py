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

def categorize_transactions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add 'category' and 'suggested_category' columns to a transactions DataFrame.

    Priority order:
      1. User-defined rules (user_rules.py) — highest priority, always win
      2. Income keyword matching for negative amounts
      3. Expense keyword matching for positive amounts

    Returns a copy of df with the two new columns.
    """
    from user_rules import apply_rules  # local import to avoid circular dependency

    df = df.copy()

    def _categorize_row(row):
        rule_cat = apply_rules(row["description"])
        if rule_cat is not None:
            return (rule_cat, None)
        if row["expense_amount"] < 0:
            return categorize_income(row["description"])
        return categorize(row["description"])

    results = df.apply(_categorize_row, axis=1)
    df["category"] = results.apply(lambda t: t[0])
    df["suggested_category"] = results.apply(lambda t: t[1])

    return df
