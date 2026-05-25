"""routes/plaid_routes.py — /api/plaid/* endpoints."""
from __future__ import annotations

import datetime
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.store import load_config, save_config, load_df, save_df, user_dir, backup_before_sync, restore_latest_backup, count_user_edited

router = APIRouter()


@router.post("/api/plaid/link-token")
async def plaid_link_token(current_user: str = Depends(get_current_user)) -> dict:
    cfg = load_config(current_user)
    if not cfg.get("plaid_client_id") or not cfg.get("plaid_secret"):
        raise HTTPException(400, "Plaid keys not configured — add them in Settings")
    try:
        from core.plaid_client import create_link_token
        return {"link_token": create_link_token(cfg=cfg)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/plaid/exchange")
async def plaid_exchange(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    try:
        from core.plaid_client import exchange_and_save
        exchange_and_save(
            body["public_token"],
            body.get("institution_name", "Unknown"),
            cfg=load_config(current_user),
            data_dir=str(user_dir(current_user)),
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/api/plaid/accounts")
def plaid_accounts(current_user: str = Depends(get_current_user)) -> dict:
    try:
        from core.plaid_client import get_connected_accounts, is_configured
        cfg      = load_config(current_user)
        data_dir = str(user_dir(current_user))
        return {
            "configured": is_configured(cfg),
            "accounts":   get_connected_accounts(data_dir=data_dir),
        }
    except Exception as e:
        return {"configured": False, "accounts": [], "error": str(e)}


@router.post("/api/plaid/sync")
async def plaid_sync(body: dict[str, Any] = {}, current_user: str = Depends(get_current_user)) -> dict:
    try:
        from core.plaid_client import sync_all_transactions, refresh_all, _load_items, _save_items
        from categorizer.rules import categorize_transactions

        cfg      = load_config(current_user)
        data_dir = str(user_dir(current_user))

        # Snapshot before touching any data — keeps last 5 backups
        backup_before_sync(current_user)
        pre_sync_edited = count_user_edited(current_user)

        if body.get("full"):
            items = _load_items(data_dir=data_dir)
            for item in items:
                item["cursor"] = None
            _save_items(items, data_dir=data_dir)

        t0 = time.monotonic()
        refresh_all(cfg=cfg, data_dir=data_dir)
        t_refresh = time.monotonic()
        logger.info("[sync:%s] refresh_all done in %.1fs", current_user, t_refresh - t0)

        existing = load_df(current_user)
        df, errors, stats = sync_all_transactions(existing, cfg=cfg, data_dir=data_dir)
        t_sync = time.monotonic()
        logger.info("[sync:%s] transactions fetched in %.1fs — added=%s modified=%s removed=%s",
                    current_user, t_sync - t_refresh,
                    stats.get("added", 0), stats.get("modified", 0), stats.get("removed", 0))
        if stats["added"] > 0:
            # Only auto-categorize rows that the user hasn't manually edited
            user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).infer_objects(copy=False).astype(bool)
            unedited_idx = df.index[~user_edited]
            if len(unedited_idx) > 0:
                t_rules0 = time.monotonic()
                recategorized = categorize_transactions(df.loc[unedited_idx], user_rules_path=user_dir(current_user) / "user_rules.py")
                df.loc[unedited_idx, "category"] = recategorized["category"].values
                if "suggested_category" in recategorized.columns:
                    df.loc[unedited_idx, "suggested_category"] = recategorized["suggested_category"].values
                logger.info("[sync:%s] rule categorization done in %.1fs (%d rows)", current_user, time.monotonic() - t_rules0, len(unedited_idx))
            if "transaction_type" not in df.columns:
                df["transaction_type"] = None
            mask = df["transaction_type"].isna() | (df["transaction_type"].astype(str) == "None")
            df.loc[mask & (df["expense_amount"] >= 0), "transaction_type"] = "expense"
            # Only mark as income if category is an actual income category — not just any credit
            from core.categories import map_category as _mc
            _income_cats = {"income", "freelance-and-side-income", "paycheck-and-salary",
                            "investment-and-dividend-income", "other-income"}
            _is_income_cat = df["category"].apply(lambda c: _mc(str(c or "")) in _income_cats)
            df.loc[mask & (df["expense_amount"] < 0) & _is_income_cat,  "transaction_type"] = "income"
            df.loc[mask & (df["expense_amount"] < 0) & ~_is_income_cat, "transaction_type"] = "expense"

            # LLM categorization for still-pending unedited rows.
            # Result goes into category but approved stays False → shows in Review tab.
            pending_llm = (
                df["category"].isin(["Pending Review", "pending review", ""]) | df["category"].isna()
            ) & ~user_edited
            if pending_llm.any():
                _provider = cfg.get("preferred_provider", "claude")
                _api_key  = (
                    cfg.get("anthropic_api_key") if _provider == "claude"
                    else cfg.get("gemini_api_key")
                )
                if _api_key:
                    try:
                        from categorizer.llm import llm_categorize_all
                        _pend_df    = df[pending_llm]
                        _descs      = _pend_df["description"].tolist()
                        _types      = _pend_df["transaction_type"].fillna("expense").tolist()
                        _extra_cats = [c["name"] for c in cfg.get("custom_categories", [])]
                        t_llm0 = time.monotonic()
                        _cats, _    = llm_categorize_all(_descs, api_key=_api_key, provider=_provider, transaction_types=_types, extra_expense_cats=_extra_cats)
                        logger.info("[sync:%s] LLM categorization (%s) done in %.1fs (%d rows)", current_user, _provider, time.monotonic() - t_llm0, len(_descs))
                        if _cats:
                            df.loc[pending_llm, "category"] = _cats
                    except Exception:
                        pass

            from core.categories import detect_refund_pairs
            df, _ = detect_refund_pairs(df, user_rules_path=user_dir(current_user) / "user_rules.py")
            save_df(current_user, df)

        # Integrity check: user-edited row count must never decrease after sync.
        # If it does, restore the backup and re-apply only genuinely new rows on top.
        post_sync_edited = count_user_edited(current_user)
        if post_sync_edited < pre_sync_edited:
            restored = restore_latest_backup(current_user)
            if restored:
                clean_df = load_df(current_user)
                if clean_df is not None and not clean_df.empty and "plaid_txn_id" in df.columns:
                    existing_ids = set(clean_df["plaid_txn_id"].dropna().astype(str))
                    new_rows = df[~df["plaid_txn_id"].astype(str).isin(existing_ids)]
                    if not new_rows.empty:
                        merged = pd.concat([clean_df, new_rows], ignore_index=True)
                        save_df(current_user, merged)
                    # else nothing new to add — clean_df is already saved

        cfg2 = load_config(current_user)
        cfg2["last_sync"] = datetime.datetime.utcnow().isoformat() + "Z"
        save_config(current_user, cfg2)
        t_total = time.monotonic()
        logger.info("[sync:%s] total sync time: %.1fs", current_user, t_total - t0)
        return {"ok": True, "stats": stats, "errors": errors, "last_sync": cfg2["last_sync"]}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/api/plaid/sync_status")
def plaid_sync_status(current_user: str = Depends(get_current_user)) -> dict:
    cfg       = load_config(current_user)
    last_sync = cfg.get("last_sync")
    needs_sync = True
    if last_sync:
        try:
            last_dt    = datetime.datetime.fromisoformat(last_sync.replace("Z", ""))
            needs_sync = (datetime.datetime.utcnow() - last_dt).total_seconds() > 24 * 3600
        except Exception:
            pass
    return {"last_sync": last_sync, "needs_sync": needs_sync}


@router.get("/api/investments")
def get_investments(current_user: str = Depends(get_current_user)) -> dict:
    import datetime, json
    try:
        from core.plaid_client import get_investment_data, is_configured
        cfg = load_config(current_user)
        if not is_configured(cfg):
            return {"holdings": [], "transactions": [], "snapshots": [], "errors": [], "configured": False}

        data = get_investment_data(cfg=cfg, data_dir=str(user_dir(current_user)))
        data["configured"] = True

        # Record daily portfolio value snapshot for historical chart
        snap_path = user_dir(current_user) / "investment_snapshots.json"
        snapshots = json.loads(snap_path.read_text()) if snap_path.exists() else []

        total = sum(h["value"] for h in data["holdings"])
        today = datetime.date.today().isoformat()

        # Replace today's entry if present, otherwise append
        snapshots = [s for s in snapshots if s["date"] != today]
        if total > 0:
            snapshots.append({"date": today, "value": total})

        # Keep last 2 years, sorted
        cutoff = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
        snapshots = sorted([s for s in snapshots if s["date"] >= cutoff], key=lambda s: s["date"])
        snap_path.write_text(json.dumps(snapshots))

        data["snapshots"] = snapshots
        return data
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/api/plaid/accounts/{item_id}")
async def plaid_remove_account(item_id: str, current_user: str = Depends(get_current_user)) -> dict:
    try:
        from core.plaid_client import remove_account
        remove_account(item_id, data_dir=str(user_dir(current_user)))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
