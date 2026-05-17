"""routes/plaid_routes.py — /api/plaid/* endpoints."""
from __future__ import annotations

import datetime
from typing import Any

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
        from plaid_client import create_link_token
        return {"link_token": create_link_token(cfg=cfg)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/plaid/exchange")
async def plaid_exchange(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    try:
        from plaid_client import exchange_and_save
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
        from plaid_client import get_connected_accounts, is_configured
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
        from plaid_client import sync_all_transactions, refresh_all, _load_items, _save_items
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

        refresh_all(cfg=cfg, data_dir=data_dir)
        existing = load_df(current_user)
        df, errors, stats = sync_all_transactions(existing, cfg=cfg, data_dir=data_dir)
        if stats["added"] > 0:
            # Only auto-categorize rows that the user hasn't manually edited
            user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
            unedited_idx = df.index[~user_edited]
            if len(unedited_idx) > 0:
                recategorized = categorize_transactions(df.loc[unedited_idx])
                df.loc[unedited_idx, "category"] = recategorized["category"].values
                if "suggested_category" in recategorized.columns:
                    df.loc[unedited_idx, "suggested_category"] = recategorized["suggested_category"].values
            if "transaction_type" not in df.columns:
                df["transaction_type"] = None
            mask = df["transaction_type"].isna() | (df["transaction_type"].astype(str) == "None")
            df.loc[mask & (df["expense_amount"] >= 0), "transaction_type"] = "expense"
            df.loc[mask & (df["expense_amount"] < 0),  "transaction_type"] = "income"
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


@router.delete("/api/plaid/accounts/{item_id}")
async def plaid_remove_account(item_id: str, current_user: str = Depends(get_current_user)) -> dict:
    try:
        from plaid_client import remove_account
        remove_account(item_id, data_dir=str(user_dir(current_user)))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
