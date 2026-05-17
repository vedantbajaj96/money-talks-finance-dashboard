"""
subscriptions.py — Recurring charge detection.

Identifies transactions that appear at a regular cadence (weekly, bi-weekly,
monthly, quarterly, or annual) by grouping expenses on a normalized description
and measuring the median interval between consecutive charges.

Public entry point: detect_recurring(df)
"""

from __future__ import annotations

import re

import pandas as pd


# Tolerance window (±days) around each canonical interval
_CADENCES = [
    ("Weekly",     7,   2),
    ("Bi-weekly",  14,  3),
    ("Monthly",    30,  6),
    ("Quarterly",  91,  10),
    ("Annual",     365, 20),
]

# Multipliers to convert one charge → estimated monthly cost
_MONTHLY_MULTIPLIER = {
    "Weekly":     4.33,
    "Bi-weekly":  2.17,
    "Monthly":    1.0,
    "Quarterly":  1 / 3,
    "Annual":     1 / 12,
}


def _normalize(description: str) -> str:
    """
    Collapse a merchant description to a stable grouping key.

    Strips trailing reference numbers, punctuation, and extra whitespace so
    that "NETFLIX.COM *12345" and "NETFLIX.COM" map to the same key.
    """
    s = description.lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)   # keep only letters, digits, spaces
    s = re.sub(r"\b\d{4,}\b", " ", s)    # drop long digit sequences (order IDs)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _classify_interval(median_days: float) -> str | None:
    """Return the cadence name if median_days falls within a known window, else None."""
    for name, center, tolerance in _CADENCES:
        if abs(median_days - center) <= tolerance:
            return name
    return None


def detect_recurring(
    df: pd.DataFrame,
    min_occurrences: int = 2,
    amount_tolerance: float = 0.15,
) -> pd.DataFrame:
    """
    Scan expense transactions for recurring charges.

    Parameters
    ----------
    df : pd.DataFrame
        Full transactions DataFrame (income + expense rows).
    min_occurrences : int
        Minimum number of times a charge must appear to be flagged.
    amount_tolerance : float
        Maximum fractional deviation from median amount still considered
        consistent (default 15%).

    Returns
    -------
    pd.DataFrame
        One row per detected subscription, sorted by estimated monthly cost
        descending. Columns: description, category, amount, frequency,
        occurrences, last_charge, est_monthly_cost.
        Returns an empty DataFrame if nothing is detected.
    """
    # Fall back to amount sign when transaction_type is missing
    # (Plaid convention: positive expense_amount = money out)
    has_types = (
        "transaction_type" in df.columns
        and df["transaction_type"].notna().any()
        and df["transaction_type"].astype(str).ne("None").any()
    )
    if has_types:
        expenses = df[df["transaction_type"] == "expense"].copy()
    else:
        expenses = df[df["expense_amount"] > 0].copy()
    if expenses.empty:
        return pd.DataFrame()

    expenses["_key"] = expenses["description"].apply(_normalize)
    results = []

    for key, group in expenses.groupby("_key"):
        if len(group) < min_occurrences:
            continue

        group = group.sort_values("date")
        dates   = group["date"].tolist()
        amounts = group["expense_amount"].tolist()

        # Need at least 2 dates to compute an interval
        if len(dates) < 2:
            continue

        # Median inter-charge interval
        deltas      = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        median_days = sorted(deltas)[len(deltas) // 2]

        cadence = _classify_interval(median_days)
        if cadence is None:
            continue

        # Amount must be consistent (within tolerance of the median)
        median_amount = sorted(amounts)[len(amounts) // 2]
        if median_amount <= 0:
            continue
        if any(abs(a - median_amount) / median_amount > amount_tolerance for a in amounts):
            continue

        results.append({
            "description":     group["description"].iloc[-1],   # most recent spelling
            "category":        group["category"].mode().iloc[0],  # most common category
            "amount":          round(median_amount, 2),
            "frequency":       cadence,
            "occurrences":     len(group),
            "last_charge":     group["date"].max().date(),
            "est_monthly_cost": round(median_amount * _MONTHLY_MULTIPLIER[cadence], 2),
        })

    if not results:
        return pd.DataFrame()

    return (
        pd.DataFrame(results)
        .sort_values("est_monthly_cost", ascending=False)
        .reset_index(drop=True)
    )
