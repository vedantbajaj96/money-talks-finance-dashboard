# user_rules.py — Custom transaction categorization rules.
#
# This file is a template. Copy it to data/<your_username>/user_rules.py
# and edit it there — that copy is gitignored and personal to you.
#
# Two rule types:
#
# RULES — simple substring match, no amount condition:
#   ("pattern", "Category Name")
#   pattern  — substring match (case-insensitive) on the transaction description
#   category — exact name from ALL_CATEGORIES / INCOME_CATEGORIES in categorizer/constants.py
#
# AMOUNT_RULES — same but only fires within an amount range:
#   ("pattern", min_amount, max_amount, "Category Name")
#   min_amount / max_amount are inclusive; use None for open-ended.
#   Amount is always the absolute value (so a $40 charge = 40.0).
#   Amount rules are checked before plain RULES.

RULES: list[tuple[str, str]] = [
    # ("NETFLIX", "Entertainment"),
    # ("STARBUCKS", "Dining & Drinks"),
]

AMOUNT_RULES: list[tuple[str, float | None, float | None, str]] = [
    # ("costco", 40.0, 85.0, "Commute & Transport"),  # gas fill-up
    # ("costco", None, None, "Groceries"),             # everything else
]


def apply_rules(description: str, amount: float = 0.0):
    """Return a category name if description matches a custom rule, else None."""
    desc = (description or "").lower()
    abs_amount = abs(amount)

    for pattern, lo, hi, category in AMOUNT_RULES:
        if pattern.lower() not in desc:
            continue
        if lo is not None and abs_amount < lo:
            continue
        if hi is not None and abs_amount > hi:
            continue
        return category

    for pattern, category in RULES:
        if pattern.lower() in desc:
            return category

    return None
