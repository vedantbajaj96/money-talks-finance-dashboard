"""
merchants.py — Merchant name normalization and grouping.

normalize_merchant(description) returns a canonical merchant name by stripping:
  - Order/reference IDs (alphanumeric suffixes)
  - Location noise (#store, city names, state codes)
  - Card-last-four digits
  - Common suffixes (LLC, INC, CO, CORP)
  - Excess punctuation and whitespace

add_merchant_column(df) adds a "merchant" column to a transactions DataFrame.
"""

from __future__ import annotations

import re

import pandas as pd

# Patterns to strip from raw descriptions
_PATTERNS = [
    r"\b[A-Z0-9]{8,}\b",              # long alphanumeric order/ref IDs
    r"#\d+",                           # store numbers like #1234
    r"\*[A-Z0-9]+",                    # suffixes like *AB1234
    r"\b\d{4,}\b",                     # standalone 4+ digit numbers
    r"\b(LLC|INC|CORP|CO|LTD|L\.L\.C)\b",  # corporate suffixes
    r"\b[A-Z]{2}\b(?=\s|$)",           # trailing 2-letter state codes
    r"[^\w\s&\-]",                     # non-alphanumeric except & and -
    r"\s{2,}",                         # multiple spaces → single space
]

# Known merchant aliases → canonical name
_ALIASES: dict[str, str] = {
    "amzn":          "Amazon",
    "amazon":        "Amazon",
    "wholefds":      "Whole Foods",
    "whole foods":   "Whole Foods",
    "tgt":           "Target",
    "wmt":           "Walmart",
    "mcdonald":      "McDonald's",
    "starbucks":     "Starbucks",
    "sbux":          "Starbucks",
    "uber eats":     "Uber Eats",
    "doordash":      "DoorDash",
    "netflix":       "Netflix",
    "spotify":       "Spotify",
    "apple":         "Apple",
    "google":        "Google",
    "microsoft":     "Microsoft",
    "chevron":       "Chevron",
    "shell":         "Shell",
    "bp":            "BP",
    "exxon":         "ExxonMobil",
}


def normalize_merchant(description: str) -> str:
    """
    Return a canonical, human-readable merchant name from a raw transaction description.
    """
    if not description:
        return "Unknown"

    text = str(description).upper()

    # Strip each noise pattern
    for pat in _PATTERNS[:-1]:  # all but whitespace collapse
        text = re.sub(pat, " ", text)
    text = re.sub(_PATTERNS[-1], " ", text)  # collapse spaces
    text = text.strip().title()

    # Check aliases (case-insensitive prefix match)
    lower = text.lower()
    for alias, canonical in _ALIASES.items():
        if lower.startswith(alias):
            return canonical

    # Truncate to first 30 chars to keep labels clean
    return text[:30].strip() if text else "Unknown"


def add_merchant_column(df: pd.DataFrame) -> pd.DataFrame:
    """Add a 'merchant' column with normalized names."""
    df = df.copy()
    df["merchant"] = df["description"].apply(normalize_merchant)
    return df


def merchant_summary(df: pd.DataFrame) -> pd.DataFrame:
    """
    Return a summary DataFrame grouped by merchant:
      merchant, transaction_count, total_spent, avg_transaction
    Only includes expense transactions (expense_amount > 0).
    Sorted by total_spent descending.
    """
    expenses = df[df["expense_amount"] > 0].copy()
    if expenses.empty:
        return pd.DataFrame(columns=["merchant", "transaction_count", "total_spent", "avg_transaction"])

    if "merchant" not in expenses.columns:
        expenses = add_merchant_column(expenses)

    summary = (
        expenses.groupby("merchant")
        .agg(
            transaction_count=("expense_amount", "count"),
            total_spent=("expense_amount", "sum"),
        )
        .reset_index()
    )
    summary["avg_transaction"] = summary["total_spent"] / summary["transaction_count"]
    return summary.sort_values("total_spent", ascending=False).reset_index(drop=True)
