"""routes/upload_routes.py — /api/upload and /api/repair endpoints."""
from __future__ import annotations

import hashlib
import io
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core.auth import get_current_user
from core.categories import detect_refund_pairs
from core.store import load_config, load_df, save_df, user_dir

router = APIRouter()

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@router.post("/api/upload")
async def upload_csv(
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user),
) -> dict:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)")
    try:
        raw_df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not read CSV: {e}")

    from core.parsers import detect_format, parse_chase_bank, parse_chase_cc, parse_amex, deduplicate
    fmt = detect_format(raw_df)
    if fmt == "chase_bank":
        parsed = parse_chase_bank(raw_df)
    elif fmt == "chase_cc":
        parsed = parse_chase_cc(raw_df)
    elif fmt == "amex":
        parsed = parse_amex(raw_df)
    else:
        raise HTTPException(400, f"Unrecognized CSV format. Columns: {list(raw_df.columns)}")

    parsed = parsed.dropna(subset=["date", "expense_amount"])
    if parsed.empty:
        raise HTTPException(400, "No valid transactions found in file")

    from categorizer.rules import categorize_transactions
    parsed = categorize_transactions(parsed, user_rules_path=user_dir(current_user) / "user_rules.py")

    cfg        = load_config(current_user)
    claude_key = cfg.get("anthropic_api_key", "")
    gemini_key = cfg.get("gemini_api_key", "")
    provider   = cfg.get("preferred_provider", "claude")
    pending_mask = parsed["category"].isin(["Pending Review", "", None]) | parsed["category"].isna()
    if pending_mask.any() and (claude_key or gemini_key):
        try:
            from categorizer.llm import llm_categorize_all
            api_key = claude_key if provider == "claude" else gemini_key
            if not api_key:
                provider = "gemini" if provider == "claude" else "claude"
                api_key  = gemini_key or claude_key
            pending_df  = parsed[pending_mask]
            descs       = pending_df["description"].tolist()
            types       = pending_df.get("transaction_type", pd.Series("expense", index=pending_df.index)).fillna("expense").tolist()
            extra_cats  = [c["name"] for c in cfg.get("custom_categories", [])]
            categories, _ = llm_categorize_all(descs, api_key=api_key, provider=provider, transaction_types=types, extra_expense_cats=extra_cats)
            if categories:
                parsed.loc[pending_mask, "category"] = categories
        except Exception:
            pass

    existing = load_df(current_user)
    combined = pd.concat([existing, parsed], ignore_index=True) if existing is not None else parsed.copy()
    combined, dupes_removed = deduplicate(combined)
    combined, _ = detect_refund_pairs(combined, user_rules_path=user_dir(current_user) / "user_rules.py")
    save_df(current_user, combined)

    return {
        "ok":         True,
        "format":     fmt,
        "new":        len(parsed),
        "duplicates": dupes_removed,
        "total":      len(combined),
    }


@router.post("/api/repair")
def repair_data(current_user: str = Depends(get_current_user)) -> dict:
    df = load_df(current_user)
    if df is None:
        raise HTTPException(404, "No data")

    for col in ["transaction_type", "notes", "tags", "txn_id", "merchant"]:
        if col in df.columns:
            df[col] = df[col].astype(object).where(df[col].notna(), None)
            df[col] = df[col].apply(lambda v: str(v) if v not in (None, "None", "nan") else None)

    if "transaction_type" not in df.columns:
        df["transaction_type"] = None
    mask_missing = df["transaction_type"].isna() | (df["transaction_type"] == "None")
    df.loc[mask_missing & (df["expense_amount"] < 0),  "transaction_type"] = "income"
    df.loc[mask_missing & (df["expense_amount"] >= 0), "transaction_type"] = "expense"

    for col in ["notes", "tags"]:
        if col not in df.columns or df[col].isna().all():
            df[col] = ""
        df[col] = df[col].fillna("")

    if "txn_id" not in df.columns or df["txn_id"].isna().all():
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )

    user_edited_mask = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).infer_objects(copy=False).astype(bool)
    pending       = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
    pending_count = int(pending.sum())

    llm_done = 0
    cfg          = load_config(current_user)
    _repair_prov = cfg.get("preferred_provider", "claude")
    if pending_count > 0 and (cfg.get("anthropic_api_key") or cfg.get("gemini_api_key")):
        try:
            from categorizer.llm import llm_categorize_all
            pending_mask = (df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()) & ~user_edited_mask
            pending_df   = df[pending_mask]
            descs = pending_df["description"].tolist()
            types = pending_df["transaction_type"].fillna("expense").tolist()

            provider = _repair_prov
            api_key = cfg.get("anthropic_api_key") if provider == "claude" else cfg.get("gemini_api_key")
            if not api_key:
                provider = "gemini" if provider == "claude" else "claude"
                api_key  = cfg.get("gemini_api_key") or cfg.get("anthropic_api_key")

            extra_cats  = [c["name"] for c in cfg.get("custom_categories", [])]
            categories, err = llm_categorize_all(descs, api_key=api_key, provider=provider, transaction_types=types, extra_expense_cats=extra_cats)
            if categories:
                df.loc[pending_mask, "category"] = categories
                still_pending = df["category"].isin(["Pending Review", None, ""]) | df["category"].isna()
                llm_done = pending_count - int(still_pending.sum())
        except Exception:
            pass

    df, refund_pairs = detect_refund_pairs(df, user_rules_path=user_dir(current_user) / "user_rules.py")
    save_df(current_user, df)
    return {
        "ok":             True,
        "total":          len(df),
        "type_fixed":     int(mask_missing.sum()),
        "pending_before": pending_count,
        "llm_categorized": llm_done,
        "refund_pairs":   refund_pairs,
    }
