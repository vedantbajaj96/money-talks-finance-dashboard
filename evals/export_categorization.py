"""
evals/export_categorization.py — Export last N transactions with keyword rules,
llama3.2, Gemini, and Claude categorizations side-by-side for manual eval.

Usage:
    python evals/export_categorization.py                  # uses vedant, last 100
    python evals/export_categorization.py --user yashna --n 200
    python evals/export_categorization.py --out my_eval.xlsx

Output: evals/categorization_eval.xlsx
Columns:
    date, description, amount, type,
    keyword_rule  — what the keyword rules engine picks (no AI)
    llama3.2      — local Ollama model
    gemini        — Gemini 3.1 flash-lite
    claude        — Claude (Opus)
    your_pick     — your manually set category (if you edited it)
    correct       — blank: fill this in yourself
    why_wrong     — blank: tag misses (keyword_missing / prompt_issue / ambiguous / wrong_type)
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd

from core.store import data_file, load_config
from categorizer.rules import categorize, categorize_income
from categorizer.llm import llm_categorize_all, _categorize_batch_ollama
from categorizer.constants import ALL_CATEGORIES, INCOME_CATEGORIES, REIMBURSEMENT_CATEGORY


def _keyword_category(description: str, expense_amount: float) -> str:
    if expense_amount < 0:
        cat, _ = categorize_income(description)
    else:
        cat, _ = categorize(description)
    return cat


def _run_ollama(descs: list[str], types: list[str], model: str, label: str) -> list[str]:
    """Run Ollama one-at-a-time with 3 retries per transaction."""
    results: list[str] = []
    t0 = time.time()
    for i, (desc, txn_type) in enumerate(zip(descs, types)):
        result = "ERROR"
        for _ in range(3):
            cats, err = _categorize_batch_ollama([desc], transaction_types=[txn_type], model=model)
            if cats and not err:
                result = cats[0]
                break
        results.append(result)
        print(f"  {label}: {i + 1}/{len(descs)}", end="\r")
    secs = time.time() - t0
    errors = results.count("ERROR")
    print(f"\n  {label}: {secs:.1f}s  ({secs/len(descs):.2f}s/txn)  errors={errors}")
    return results


def _run_cloud(descs: list[str], types: list[str], api_key: str, provider: str) -> list[str]:
    t0 = time.time()
    cats, err = llm_categorize_all(descs, api_key=api_key, provider=provider, transaction_types=types)
    secs = time.time() - t0
    if err:
        print(f"  {provider} error: {err}")
        return ["ERROR"] * len(descs)
    print(f"  {provider}: {secs:.1f}s  ({secs/len(descs):.2f}s/txn)")
    return cats


def run_export(username: str, n: int, out_path: Path) -> None:
    parquet = data_file(username)
    if not parquet.exists():
        print(f"No data found for user '{username}' at {parquet}")
        sys.exit(1)

    df = pd.read_parquet(parquet)
    df = df.sort_values("date", ascending=False).head(n).reset_index(drop=True)
    print(f"Loaded {len(df)} transactions for '{username}'")

    cfg   = load_config(username)
    descs = df["description"].astype(str).tolist()
    types = df.apply(
        lambda r: "income" if float(r.get("expense_amount", 0)) < 0 else "expense",
        axis=1,
    ).tolist()

    # ── Keyword rules ─────────────────────────────────────────────────────
    print("Running keyword rules...")
    df["keyword_rule"] = df.apply(
        lambda r: _keyword_category(str(r["description"]), float(r.get("expense_amount", 0))),
        axis=1,
    )

    # ── llama3.2 ──────────────────────────────────────────────────────────
    print("Running llama3.2...")
    df["llama3.2"] = _run_ollama(descs, types, "llama3.2:latest", "llama3.2")

    # ── Gemini ────────────────────────────────────────────────────────────
    gemini_key = cfg.get("gemini_api_key")
    if gemini_key:
        print("Running Gemini...")
        df["gemini"] = _run_cloud(descs, types, gemini_key, "gemini")
    else:
        print("  No Gemini key — skipping")
        df["gemini"] = "NO KEY"

    # ── Claude ────────────────────────────────────────────────────────────
    claude_key = cfg.get("anthropic_api_key")
    if claude_key:
        print("Running Claude...")
        df["claude"] = _run_cloud(descs, types, claude_key, "claude")
    else:
        print("  No Claude key — skipping")
        df["claude"] = "NO KEY"

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
        "llama3.2":     df["llama3.2"],
        "gemini":       df["gemini"],
        "claude":       df["claude"],
        "your_pick":    df["your_pick"],
        "why_wrong":    "",   # keyword_missing / prompt_issue / ambiguous / wrong_type
    })

    # ── Write Excel ───────────────────────────────────────────────────────
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        export.to_excel(writer, sheet_name="Transactions", index=False)

        all_cats = ALL_CATEGORIES + [REIMBURSEMENT_CATEGORY, "Refund / Return"] + INCOME_CATEGORIES
        pd.DataFrame({
            "category": all_cats,
            "type": (["expense"] * 13) + (["income"] * 5),
        }).to_excel(writer, sheet_name="Categories", index=False)

        ws = writer.sheets["Transactions"]
        for col, width in {"A":12,"B":45,"C":10,"D":10,"E":25,"F":25,"G":25,"H":25,"I":25,"J":20}.items():
            ws.column_dimensions[col].width = width
        ws.freeze_panes = "A2"

        # Dropdown for your_pick (col I) — hidden col K holds category list (works in Excel Online)
        from openpyxl.worksheet.datavalidation import DataValidation
        for i, cat in enumerate(all_cats):
            ws.cell(row=i + 2, column=11, value=cat)
        ws.column_dimensions["K"].hidden = True
        dv = DataValidation(
            type="list",
            formula1="$K$2:$K$19",
            allow_blank=True,
            showDropDown=False,
        )
        dv.sqref = f"I2:I{len(export) + 1}"
        ws.add_data_validation(dv)

    print(f"\nExported to: {out_path}")
    print(f"  {len(export)} transactions  |  {int(user_edited.sum())} already have your pick")
    print(f"\nNext: fill in 'your_pick' column, then run:  python3 evals/score_eval.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", default="vedant")
    parser.add_argument("--n",    default=100, type=int)
    parser.add_argument("--out",  default=None)
    args = parser.parse_args()
    out = Path(args.out) if args.out else ROOT / "evals" / "categorization_eval.xlsx"
    run_export(args.user, args.n, out)
