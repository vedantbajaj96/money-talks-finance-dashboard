"""
evals/export_categorization.py — Export last N transactions with keyword rules,
Gemini, and Claude categorizations side-by-side for manual eval.

Usage:
    python evals/export_categorization.py                  # uses vedant, last 100
    python evals/export_categorization.py --user yashna --n 200
    python evals/export_categorization.py --out my_eval.xlsx

Output: evals/categorization_eval.xlsx
Columns:
    date, description, amount, type,
    user_rule     — matched by your personal rules (data/<user>/user_rules.py)
    keyword_rule  — what the keyword rules engine picks (no AI)
    gemini        — Gemini flash-lite   (skipped for user_rule rows)
    claude        — Claude              (skipped for user_rule rows)
    your_pick     — pre-filled from user_rule; fill in manually for the rest
    why_wrong     — blank: tag misses (keyword_missing / prompt_issue / ambiguous / wrong_type)
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


class _Tee:
    """Write to both the original stream and a log file."""
    def __init__(self, stream, log_path: Path):
        self._stream = stream
        self._log = open(log_path, "w", buffering=1, encoding="utf-8")

    def write(self, data):
        self._stream.write(data)
        self._log.write(data)

    def flush(self):
        self._stream.flush()
        self._log.flush()

    def fileno(self):
        return self._stream.fileno()

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd

from core.store import data_file, load_config, user_dir
from categorizer.rules import categorize, categorize_income
from categorizer.llm import llm_categorize_all
from categorizer.constants import ALL_CATEGORIES, INCOME_CATEGORIES, REIMBURSEMENT_CATEGORY


def _keyword_category(description: str, expense_amount: float) -> str:
    if expense_amount < 0:
        cat, _ = categorize_income(description)
    else:
        cat, _ = categorize(description)
    return cat


def _user_rule_category(description: str, expense_amount: float, username: str) -> str:
    """Return the user-rule category if matched, else empty string."""
    from categorizer.rules import _load_apply_rules
    apply_rules = _load_apply_rules(user_dir(username) / "user_rules.py")
    result = apply_rules(description, expense_amount)
    return result or ""




def _run_cloud(descs: list[str], types: list[str], api_key: str, provider: str) -> tuple[list[str], float]:
    """Returns (results, elapsed_secs)."""
    t0 = time.time()
    cats, err = llm_categorize_all(descs, api_key=api_key, provider=provider, transaction_types=types)
    secs = time.time() - t0
    if err:
        print(f"  {provider} error: {err}", flush=True)
        return ["ERROR"] * len(descs), secs
    print(f"  {provider}: {secs:.1f}s  ({secs/len(descs):.2f}s/txn)", flush=True)
    return cats, secs


def run_export(username: str, n: int, out_path: Path) -> None:
    parquet = data_file(username)
    if not parquet.exists():
        print(f"No data found for user '{username}' at {parquet}")
        sys.exit(1)

    df = pd.read_parquet(parquet)
    df = df.sort_values("date", ascending=False).head(n)
    df = df.reindex(df["expense_amount"].abs().sort_values(ascending=False).index).reset_index(drop=True)
    print(f"Loaded {len(df)} transactions for '{username}'")

    cfg   = load_config(username)
    descs = df["description"].astype(str).tolist()
    types = df.apply(
        lambda r: "income" if float(r.get("expense_amount", 0)) < 0 else "expense",
        axis=1,
    ).tolist()

    # ── User rules ────────────────────────────────────────────────────────
    print("Applying user rules...")
    df["user_rule"] = df.apply(
        lambda r: _user_rule_category(str(r["description"]), float(r.get("expense_amount", 0)), username),
        axis=1,
    )
    rule_matched = df["user_rule"] != ""
    n_matched = rule_matched.sum()
    print(f"  {n_matched} transactions matched by user rules — skipping models for those")

    # ── Keyword rules ─────────────────────────────────────────────────────
    print("Running keyword rules...")
    df["keyword_rule"] = df.apply(
        lambda r: _keyword_category(str(r["description"]), float(r.get("expense_amount", 0))),
        axis=1,
    )

    # For model columns, only run on non-rule-matched rows
    ai_idx   = df.index[~rule_matched].tolist()
    ai_descs = [descs[i] for i in ai_idx]
    ai_types = [types[i] for i in ai_idx]

    def _fill_model(results: list[str]) -> list[str]:
        """Expand results back to full-length list, using the user_rule result for skipped rows."""
        out = df["user_rule"].tolist()   # rule-matched rows show the rule's answer
        for pos, idx in enumerate(ai_idx):
            out[idx] = results[pos]
        return out

    timings: dict[str, float] = {}

    # ── Gemini ────────────────────────────────────────────────────────────
    gemini_key = cfg.get("gemini_api_key")
    if gemini_key and ai_descs:
        print(f"\n[1/2] Gemini — {len(ai_descs)} transactions...", flush=True)
        gemini_results, t = _run_cloud(ai_descs, ai_types, gemini_key, "gemini")
        timings["gemini"] = t
    else:
        if not gemini_key:
            print("\n[2/3] Gemini — no key, skipping", flush=True)
        gemini_results = ["NO KEY"] * len(ai_descs)
        timings["gemini"] = 0.0
    df["gemini"] = _fill_model(gemini_results)

    # ── Claude ────────────────────────────────────────────────────────────
    claude_key = cfg.get("anthropic_api_key")
    if claude_key and ai_descs:
        print(f"\n[2/2] Claude — {len(ai_descs)} transactions...", flush=True)
        claude_results, t = _run_cloud(ai_descs, ai_types, claude_key, "claude")
        timings["claude"] = t
    else:
        if not claude_key:
            print("\n[3/3] Claude — no key, skipping", flush=True)
        claude_results = ["NO KEY"] * len(ai_descs)
        timings["claude"] = 0.0
    df["claude"] = _fill_model(claude_results)

    # ── Your pick: pre-fill from user_rule, fallback to manual edits ──────
    user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
    df["your_pick"] = df["user_rule"].where(rule_matched, other=df["category"].where(user_edited, other=""))

    # ── Build export DataFrame ────────────────────────────────────────────
    # Use plain lists to avoid pandas Series index-alignment issues
    n = len(df)
    export = pd.DataFrame({
        "date":         df["date"].astype(str).str[:10].tolist(),
        "description":  df["description"].tolist(),
        "amount":       df["expense_amount"].round(2).tolist(),
        "type":         types,
        "user_rule":    df["user_rule"].tolist(),
        "keyword_rule": df["keyword_rule"].tolist(),
        "gemini":       df["gemini"].tolist(),
        "claude":       df["claude"].tolist(),
        "your_pick":    df["your_pick"].tolist(),
        "why_wrong":    [""] * n,
    })

    # ── Write Excel ───────────────────────────────────────────────────────
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        export.to_excel(writer, sheet_name="Transactions", index=False)

        all_cats = ALL_CATEGORIES + [REIMBURSEMENT_CATEGORY] + INCOME_CATEGORIES
        cat_types = (["expense"] * (len(ALL_CATEGORIES) + 1)) + (["income"] * len(INCOME_CATEGORIES))
        pd.DataFrame({
            "category": all_cats,
            "type": cat_types,
        }).to_excel(writer, sheet_name="Categories", index=False)

        ws = writer.sheets["Transactions"]
        for col, width in {"A":12,"B":45,"C":10,"D":10,"E":20,"F":25,"G":25,"H":25,"I":25,"J":25,"K":20}.items():
            ws.column_dimensions[col].width = width
        ws.freeze_panes = "A2"

        # Dropdown for your_pick (col J) — hidden col L holds category list (works in Excel Online)
        from openpyxl.worksheet.datavalidation import DataValidation
        for i, cat in enumerate(all_cats):
            ws.cell(row=i + 2, column=12, value=cat)
        ws.column_dimensions["L"].hidden = True
        dv = DataValidation(
            type="list",
            formula1=f"$L$2:$L${len(all_cats) + 1}",
            allow_blank=True,
            showDropDown=False,
        )
        dv.sqref = f"J2:J{len(export) + 1}"
        ws.add_data_validation(dv)

    print(f"\nExported to: {out_path}")
    print(f"  {len(export)} transactions  |  {int(user_edited.sum())} already have your pick")
    print(f"\n── Model timings ──────────────────────────────────────", flush=True)
    for model, secs in timings.items():
        skipped = " (skipped)" if secs == 0.0 else ""
        print(f"  {model:<12}  {secs:.1f}s{skipped}", flush=True)
    print(f"\nNext: fill in 'your_pick' column, then run:  python3 evals/score_eval.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", default="vedant")
    parser.add_argument("--n",    default=100, type=int)
    parser.add_argument("--out",  default=None)
    args = parser.parse_args()
    out = Path(args.out) if args.out else ROOT / "evals" / "categorization_eval.xlsx"
    log_path = ROOT / "evals" / "eval_run.log"
    sys.stdout = _Tee(sys.stdout, log_path)
    sys.stderr = _Tee(sys.stderr, log_path)
    print(f"Logging to: {log_path}", flush=True)
    run_export(args.user, args.n, out)
