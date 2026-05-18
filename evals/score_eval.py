"""
evals/score_eval.py — Score a filled-in categorization eval spreadsheet.

Usage:
    python evals/score_eval.py                        # reads evals/categorization_eval.xlsx
    python evals/score_eval.py --file my_eval.xlsx

Reads the 'correct' column you filled in and scores Ollama, Gemini, and the
keyword rules. Also breaks down errors by why_wrong tag so you know where to focus.

Run this after every prompt/rules change to see if accuracy improved.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd


def score(file_path: Path) -> None:
    if not file_path.exists():
        print(f"File not found: {file_path}")
        print("Run export_categorization.py first, then fill in the 'correct' column.")
        sys.exit(1)

    df = pd.read_excel(file_path, sheet_name="Transactions")

    # Only score rows where 'correct' is filled in
    labeled = df[df["correct"].notna() & (df["correct"].astype(str).str.strip() != "")].copy()

    if labeled.empty:
        print("No rows have the 'correct' column filled in yet.")
        print("Open the Excel and fill in the correct category for each transaction.")
        sys.exit(0)

    total = len(labeled)
    print(f"\nScoring {total} labeled transactions\n")
    print("=" * 50)

    for col in ["keyword_rule", "llama3.2", "gemini", "claude"]:
        if col not in labeled.columns or labeled[col].eq("NO KEY").all():
            continue
        valid = labeled[labeled[col] != "ERROR"]
        correct = (valid[col].str.strip() == valid["correct"].str.strip()).sum()
        pct = correct / len(valid) * 100 if len(valid) > 0 else 0
        print(f"{col:<15} {correct:>3} / {len(valid):>3}   ({pct:.0f}%)")

    print("=" * 50)

    # ── Why-wrong breakdown ───────────────────────────────────────────────
    tagged = labeled[labeled["why_wrong"].notna() & (labeled["why_wrong"].astype(str).str.strip() != "")]
    if not tagged.empty:
        print(f"\nWhy-wrong breakdown ({len(tagged)} tagged misses):\n")
        counts = Counter(tagged["why_wrong"].astype(str).str.strip().str.lower())
        for tag, count in counts.most_common():
            pct = count / len(tagged) * 100
            print(f"  {tag:<25} {count:>3}  ({pct:.0f}%)")

        print("\nWhat to fix first:")
        top = counts.most_common(1)[0][0]
        fixes = {
            "keyword_missing": "Add keywords to categorizer/constants.py — these are easy wins.",
            "prompt_issue":    "The AI had enough info but still got it wrong — improve the prompt in categorizer/llm.py.",
            "ambiguous":       "Genuinely hard cases — consider adding user rules in user_rules.py for specific merchants.",
            "wrong_type":      "Income/expense confusion — check transaction_type detection in the categorizer.",
        }
        print(f"  → {fixes.get(top, 'Review the most common error type and address it.')}")
    else:
        print("\nTip: fill in the 'why_wrong' column for misses to get a breakdown of root causes.")

    # ── Worst offenders (use best available model) ────────────────────────
    best_col = next((c for c in ["claude", "gemini", "llama3.2"] if c in labeled.columns), None)
    if best_col:
        print(f"\nTop misses ({best_col} wrong, sorted by frequency):")
        wrong = labeled[labeled[best_col].str.strip() != labeled["correct"].str.strip()]
        if not wrong.empty:
            miss_counts = Counter(wrong["description"].astype(str).str[:50])
            for desc, count in miss_counts.most_common(10):
                row = wrong[wrong["description"].astype(str).str[:50] == desc].iloc[0]
                print(f"  '{desc[:40]:<40}'  {best_col}={row[best_col]:<25} correct={row['correct']}")
        else:
            print(f"  None — {best_col} got everything right!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Score a filled-in categorization eval")
    parser.add_argument("--file", default=None, help="Path to eval xlsx (default: evals/categorization_eval.xlsx)")
    args = parser.parse_args()

    f = Path(args.file) if args.file else ROOT / "evals" / "categorization_eval.xlsx"
    score(f)
