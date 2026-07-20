"""routes/verify_routes.py — /api/verify/statement

Parse an uploaded statement and diff it against stored transactions.
Nothing is saved — this is read-only verification.
"""
from __future__ import annotations

import io
import re
import datetime

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core.auth import get_current_user
from core.store import load_df

router = APIRouter()


def _fp(desc: str) -> str:
    """Normalize description for fuzzy matching."""
    s = re.sub(r"[^a-z0-9 ]+", " ", str(desc).lower())
    words = [w for w in s.split() if len(w) > 1]
    return " ".join(words[:6])


def _within(d1: str, d2: str, days: int = 3) -> bool:
    try:
        return abs((datetime.date.fromisoformat(d1) - datetime.date.fromisoformat(d2)).days) <= days
    except Exception:
        return False


@router.post("/api/verify/statement")
async def verify_statement(
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user),
) -> dict:
    content = await file.read()

    # ── Parse the uploaded file ───────────────────────────────────
    filename = (file.filename or "").lower()
    if filename.endswith(".pdf"):
        try:
            import pdfplumber
            rows = []
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    tbl = page.extract_table()
                    if tbl:
                        rows.extend(tbl)
            if not rows:
                raise HTTPException(400, "Could not extract any tables from PDF")
            headers = [str(h or "").strip() for h in rows[0]]
            data    = [[str(c or "").strip() for c in r] for r in rows[1:] if any(r)]
            raw_df  = pd.DataFrame(data, columns=headers)
        except ImportError:
            raise HTTPException(400, "pdfplumber not installed — upload a CSV instead")
    else:
        try:
            raw_df = pd.read_csv(io.BytesIO(content))
        except Exception as e:
            raise HTTPException(400, f"Could not read CSV: {e}")

    from core.parsers import detect_format, parse_chase_bank, parse_chase_cc, parse_amex
    fmt = detect_format(raw_df)
    if fmt == "chase_bank":
        stmt = parse_chase_bank(raw_df)
    elif fmt == "chase_cc":
        stmt = parse_chase_cc(raw_df)
    elif fmt == "amex":
        stmt = parse_amex(raw_df)
    else:
        raise HTTPException(400, f"Unrecognized format. Columns found: {list(raw_df.columns)}")

    stmt = stmt.dropna(subset=["date", "expense_amount"]).copy()
    if stmt.empty:
        raise HTTPException(400, "No valid transactions found in file")

    stmt["_date"] = stmt["date"].dt.date.astype(str)
    stmt["_amt"]  = stmt["expense_amount"].round(2)
    stmt["_fp"]   = stmt["description"].apply(_fp)

    period_from = stmt["_date"].min()
    period_to   = stmt["_date"].max()
    source_name = str(stmt["source"].iloc[0])

    # ── Load stored transactions for the same period ──────────────
    stored_df = load_df(current_user)
    if stored_df is None or stored_df.empty:
        raise HTTPException(404, "No stored transactions to compare against")

    stored_df = stored_df.copy()
    stored_df["_date"] = pd.to_datetime(stored_df["date"], errors="coerce").dt.date.astype(str)
    stored_df["_amt"]  = stored_df["expense_amount"].round(2)
    stored_df["_fp"]   = stored_df["description"].apply(_fp)

    # Only compare the overlapping date window
    in_window = (stored_df["_date"] >= period_from) & (stored_df["_date"] <= period_to)
    window_df = stored_df[in_window].copy()

    # ── Fuzzy match: (amount, desc_fp) within ±3 days ────────────
    # Build lookup: (amt, fp) → [date_str, ...]
    stored_lookup: dict[tuple, list[str]] = {}
    for _, r in window_df.iterrows():
        key = (r["_amt"], r["_fp"])
        stored_lookup.setdefault(key, []).append(r["_date"])

    stmt_matched_keys: set = set()   # keys we found in stored
    stored_matched_idx: set = set()  # window_df indices consumed

    missing = []   # in statement, not found in stored
    matched_count = 0

    for i, row in stmt.iterrows():
        key = (row["_amt"], row["_fp"])
        candidates = stored_lookup.get(key, [])
        found = any(_within(row["_date"], d) for d in candidates)

        if found:
            matched_count += 1
            stmt_matched_keys.add(key)
            # Mark one stored row as consumed (remove first matching date)
            for j, srow in window_df.iterrows():
                if j in stored_matched_idx:
                    continue
                if srow["_amt"] == row["_amt"] and srow["_fp"] == row["_fp"] and _within(row["_date"], srow["_date"]):
                    stored_matched_idx.add(j)
                    break
        else:
            missing.append({
                "date":        row["_date"],
                "description": str(row["description"]),
                "amount":      float(row["_amt"]),
            })

    # Extra = stored rows in window not matched by any statement row
    extra = []
    for j, srow in window_df.iterrows():
        if j in stored_matched_idx:
            continue
        extra.append({
            "date":        srow["_date"],
            "description": str(srow.get("description", "")),
            "amount":      float(srow["_amt"]),
            "source":      str(srow.get("source", "")),
        })

    return {
        "period":  { "from": period_from, "to": period_to },
        "source":  source_name,
        "summary": {
            "statement_total": len(stmt),
            "matched":         matched_count,
            "missing":         len(missing),
            "extra":           len(extra),
        },
        "missing": sorted(missing, key=lambda r: r["date"]),
        "extra":   sorted(extra,   key=lambda r: r["date"]),
    }
