"""
evals/corrections_report.py — Report transactions where the user changed the system category.

Usage:
    python evals/corrections_report.py
    python evals/corrections_report.py --user yashna

Shows every transaction where user_edited=True and category != original_category.
These corrections are the ground truth for evaluating model/rules quality.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd
from core.store import data_file


def run_report(username: str) -> None:
    parquet = data_file(username)
    if not parquet.exists():
        print(f"No data found for user '{username}'")
        sys.exit(1)

    df = pd.read_parquet(parquet)

    if "original_category" not in df.columns:
        print("No original_category column found — run a review session first.")
        sys.exit(1)

    reviewed = df[df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)].copy()
    corrections = reviewed[
        reviewed["category"].fillna("") != reviewed["original_category"].fillna("")
    ].copy()

    total_reviewed = len(reviewed)
    total_corrected = len(corrections)

    print(f"User: {username}")
    print(f"Reviewed: {total_reviewed}  |  Corrected: {total_corrected}  ({100*total_corrected/max(total_reviewed,1):.0f}%)")

    if corrections.empty:
        print("\nNo corrections yet.")
        return

    corrections = corrections.sort_values("date", ascending=False)

    print(f"\n{'Description':<45}  {'System assigned':<28}  →  {'Your pick'}")
    print("-" * 105)
    for _, row in corrections.iterrows():
        desc = str(row["description"])[:44]
        orig = str(row.get("original_category", ""))[:27]
        pick = str(row["category"])
        print(f"  {desc:<44}  {orig:<28}  →  {pick}")

    print(f"\n── Corrections by system category ────────────────────")
    breakdown = corrections.groupby("original_category")["category"].value_counts()
    for (orig, new), count in breakdown.items():
        print(f"  {orig:<30}  →  {new:<28}  ({count}x)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", default="vedant")
    args = parser.parse_args()
    run_report(args.user)
