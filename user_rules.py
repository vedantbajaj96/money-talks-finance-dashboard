# user_rules.py — Custom transaction categorization rules.
#
# Two rule types:
#
# RULES — simple substring match, no amount condition:
#   (pattern, category)
#   pattern  — substring match (case-insensitive) on the transaction description
#   category — exact category name from ALL_CATEGORIES / INCOME_CATEGORIES
#
# AMOUNT_RULES — same as RULES but only fires within an amount range:
#   (pattern, min_amount, max_amount, category)
#   min_amount / max_amount are inclusive, use None for open-ended (e.g. None, 50)
#   Amount is always the absolute value of the transaction (so a $40 charge = 40.0)
#
# Amount rules are checked before plain RULES, so they can override the default.

RULES: list[tuple[str, str]] = [
    # Samosa House sells both food and Indian groceries — default to Groceries.
    # Manually change to Dining & Drinks on the transaction if it was a sit-down meal.
    ("samosa house", "Groceries"),
]

AMOUNT_RULES: list[tuple[str, float | None, float | None, str]] = [
    # Costco: $40–$85 is almost always a gas fill-up; outside that range it's groceries.
    ("costco", 40.0, 85.0, "Commute & Transport"),
    ("costco", None, None, "Groceries"),
]


def apply_rules(description: str, amount: float = 0.0):
    """Return a category name if description matches a custom rule, else None.

    Amount rules are checked first (most specific wins).
    """
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
