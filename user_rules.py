# user_rules.py — Custom transaction categorization rules.
# Add entries to RULES to override the built-in categorizer.
# Each entry: (pattern, category)
#   pattern  — substring match (case-insensitive) on the transaction description
#   category — must match one of the category IDs in your config

RULES: list[tuple[str, str]] = [
    # Example: ("NETFLIX", "subscriptions"),
]


def apply_rules(description: str):
    """Return a category ID if description matches a custom rule, else None."""
    desc = (description or "").lower()
    for pattern, category in RULES:
        if pattern.lower() in desc:
            return category
    return None
