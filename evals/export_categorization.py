"""
evals/export_categorization.py — Export last N transactions with Ollama + Gemini
categorizations side-by-side for manual eval.

Usage:
    python evals/export_categorization.py                  # uses vedant, last 100
    python evals/export_categorization.py --user yashna --n 200
    python evals/export_categorization.py --out my_eval.xlsx

Output: evals/categorization_eval.xlsx
Columns:
    date, description, amount, type,
    keyword_rule   — what the keyword rules engine picks (no AI)
    ollama         — what Ollama picks
    gemini         — what Gemini picks
    your_pick      — your manually set category (if you edited it)
    correct        — blank: fill this in yourself
    why_wrong      — blank: tag misses (keyword_missing / prompt_issue / ambiguous / wrong_type)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from repo root or from evals/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd

from core.store import data_file, load_config, user_dir
from categorizer.rules import categorize, categorize_income
from categorizer.llm import llm_categorize_all, _categorize_batch_ollama


def _keyword_category(description: str, expense_amount: float) -> str:
    if expense_amount < 0:
        cat, _ = categorize_income(description)
    else:
        cat, _ = categorize(description)
    return cat


def run_export(username: str, n: int, out_path: Path) -> None:
    parquet = data_file(username)
    if not parquet.exists():
        print(f"No data found for user '{username}' at {parquet}")
        sys.exit(1)

    df = pd.read_parquet(parquet)
    df = df.sort_values("date", ascending=False).head(n).reset_index(drop=True)

    print(f"Loaded {len(df)} transactions for '{username}'")

    # ── Keyword rules (no AI) ─────────────────────────────────────────────
    print("Running keyword rules...")
    df["keyword_rule"] = df.apply(
        lambda r: _keyword_category(str(r["description"]), float(r.get("expense_amount", 0))),
        axis=1,
    )

    # ── Ollama ────────────────────────────────────────────────────────────
    print("Running Ollama categorization (this may take a minute)...")
    descs = df["description"].astype(str).tolist()
    types = df.apply(
        lambda r: "income" if float(r.get("expense_amount", 0)) < 0 else "expense",
        axis=1,
    ).tolist()

    # Process one at a time — llama3.2 fails JSON output on batches
    ollama_results: list[str] = []
    for i, (desc, txn_type) in enumerate(zip(descs, types)):
        cats, err = _categorize_batch_ollama([desc], transaction_types=[txn_type])
        if err or cats is None:
            ollama_results.append("ERROR")
        else:
            ollama_results.append(cats[0])
        print(f"  Ollama: {i + 1}/{len(descs)}", end="\r")
    print()
    df["ollama"] = ollama_results

    # ── Gemini ────────────────────────────────────────────────────────────
    cfg = load_config(username)
    gemini_key = cfg.get("gemini_api_key")
    if gemini_key:
        print("Running Gemini categorization...")
        gemini_cats, err = llm_categorize_all(
            descs, api_key=gemini_key, provider="gemini", transaction_types=types
        )
        if err:
            print(f"  Gemini error: {err} — filling with 'ERROR'")
            df["gemini"] = "ERROR"
        else:
            df["gemini"] = gemini_cats
    else:
        print("  No Gemini API key found — skipping Gemini column")
        df["gemini"] = "NO KEY"

    # ── Your manual picks ─────────────────────────────────────────────────
    user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    df["your_pick"] = df["category"].where(user_edited, other="")

    # ── Build export DataFrame ────────────────────────────────────────────
    export = pd.DataFrame({
        "date":         df["date"].astype(str).str[:10],
        "description":  df["description"],
        "amount":       df["expense_amount"].round(2),
        "type":         pd.Series(types),
        "keyword_rule": df["keyword_rule"],
        "ollama":       df["ollama"],
        "gemini":       df["gemini"],
        "your_pick":    df["your_pick"],
        "correct":      "",   # fill in manually
        "why_wrong":    "",   # keyword_missing / prompt_issue / ambiguous / wrong_type
    })

    # ── Write Excel ───────────────────────────────────────────────────────
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        export.to_excel(writer, sheet_name="Transactions", index=False)

        # Second sheet: category reference list
        all_cats = [
            "Financial & Transfers", "Housing & Utilities", "Connectivity",
            "Food Delivery", "Commute & Transport", "Groceries", "Dining & Drinks",
            "Fitness & Active", "Health & Medical", "Professional Development",
            "Shopping & Retail", "Entertainment", "Travel & Getaways",
            "Paycheck & Salary", "Freelance & Side Income",
            "Investment & Dividend Income", "Reimbursements", "Other Income",
        ]
        cat_df = pd.DataFrame({
            "category": all_cats,
            "type": (["expense"] * 13) + (["income"] * 5),
        })
        cat_df.to_excel(writer, sheet_name="Categories", index=False)

        # Basic column width formatting
        ws = writer.sheets["Transactions"]
        col_widths = {
            "A": 12,  # date
            "B": 45,  # description
            "C": 10,  # amount
            "D": 10,  # type
            "E": 25,  # keyword_rule
            "F": 25,  # ollama
            "G": 25,  # gemini
            "H": 25,  # your_pick
            "I": 25,  # correct
            "J": 20,  # why_wrong
        }
        for col, width in col_widths.items():
            ws.column_dimensions[col].width = width

        # Freeze header row
        ws.freeze_panes = "A2"

    print(f"\nExported to: {out_path}")
    print(f"  {len(export)} transactions")
    print(f"  {int(user_edited.sum())} rows already have your manual pick")
    print(f"\nNext steps:")
    print(f"  1. Open the Excel, fill in the 'correct' column for every row")
    print(f"  2. Tag misses in 'why_wrong': keyword_missing / prompt_issue / ambiguous / wrong_type")
    print(f"  3. Run score_eval.py to see accuracy numbers")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export transactions for categorization eval")
    parser.add_argument("--user", default="vedant", help="Username (default: vedant)")
    parser.add_argument("--n",    default=100, type=int, help="Number of transactions (default: 100)")
    parser.add_argument("--out",  default=None, help="Output path (default: evals/categorization_eval.xlsx)")
    args = parser.parse_args()

    out = Path(args.out) if args.out else ROOT / "evals" / "categorization_eval.xlsx"
    run_export(args.user, args.n, out)
