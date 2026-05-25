"""
core/scheduler.py — Background auto-sync scheduler.

Starts a daemon thread on server startup. Every 30 minutes it checks
each user's auto_sync_interval preference and triggers a Plaid sync
if enough time has passed since their last sync.

New transactions land in the Review tab exactly as they would from a
manual sync — approved is never set by the scheduler, only by the user.
"""
from __future__ import annotations

import datetime
import logging
import threading
import time

logger = logging.getLogger(__name__)

_thread: threading.Thread | None = None


def _sync_user(username: str) -> None:
    try:
        import pandas as pd
        from core.store import (
            load_config, save_config, load_df, save_df,
            user_dir, backup_before_sync,
        )
        from core.plaid_client import (
            sync_all_transactions, refresh_all, is_configured, _load_items,
        )
        from categorizer.rules import categorize_transactions

        cfg = load_config(username)
        if not is_configured(cfg):
            return

        items = _load_items(data_dir=str(user_dir(username)))
        if not items:
            return

        data_dir = str(user_dir(username))
        backup_before_sync(username)

        refresh_all(cfg=cfg, data_dir=data_dir)
        existing = load_df(username)
        df, errors, stats = sync_all_transactions(existing, cfg=cfg, data_dir=data_dir)

        if errors:
            logger.warning("[scheduler:%s] sync errors: %s", username, errors)

        if stats["added"] > 0:
            user_edited = df.get("user_edited", pd.Series(False, index=df.index)).fillna(False).astype(bool)
            unedited_idx = df.index[~user_edited]

            if len(unedited_idx) > 0:
                recategorized = categorize_transactions(
                    df.loc[unedited_idx],
                    user_rules_path=user_dir(username) / "user_rules.py",
                )
                df.loc[unedited_idx, "category"] = recategorized["category"].values
                if "suggested_category" in recategorized.columns:
                    df.loc[unedited_idx, "suggested_category"] = recategorized["suggested_category"].values

            if "transaction_type" not in df.columns:
                df["transaction_type"] = None
            mask = df["transaction_type"].isna() | (df["transaction_type"].astype(str) == "None")
            df.loc[mask & (df["expense_amount"] >= 0), "transaction_type"] = "expense"

            from core.categories import map_category as _mc
            _income_cats = {"income", "freelance-and-side-income", "paycheck-and-salary",
                            "investment-and-dividend-income", "other-income"}
            _is_income = df["category"].apply(lambda c: _mc(str(c or "")) in _income_cats)
            df.loc[mask & (df["expense_amount"] < 0) & _is_income,  "transaction_type"] = "income"
            df.loc[mask & (df["expense_amount"] < 0) & ~_is_income, "transaction_type"] = "expense"

            save_df(username, df)

        cfg["last_sync"] = datetime.datetime.utcnow().isoformat() + "Z"
        save_config(username, cfg)
        logger.info("[scheduler:%s] sync done — added=%d modified=%d removed=%d",
                    username, stats["added"], stats["modified"], stats["removed"])

    except Exception as exc:
        logger.error("[scheduler:%s] sync failed: %s", username, exc, exc_info=True)


def _loop() -> None:
    while True:
        time.sleep(1800)  # check every 30 minutes
        try:
            from core.store import list_users, load_config
            for username in list_users():
                try:
                    cfg = load_config(username)
                    interval_hours = int(cfg.get("auto_sync_interval", 0))
                    if not interval_hours:
                        continue

                    last_sync = cfg.get("last_sync")
                    if last_sync:
                        last_dt = datetime.datetime.fromisoformat(last_sync.replace("Z", ""))
                        elapsed = (datetime.datetime.utcnow() - last_dt).total_seconds() / 3600
                        if elapsed < interval_hours:
                            continue

                    logger.info("[scheduler:%s] triggering auto-sync (interval=%dh)", username, interval_hours)
                    _sync_user(username)
                except Exception as exc:
                    logger.error("[scheduler:%s] error: %s", username, exc)
        except Exception as exc:
            logger.error("[scheduler] loop error: %s", exc)


def start() -> None:
    global _thread
    if _thread is not None:
        return
    _thread = threading.Thread(target=_loop, daemon=True, name="auto-sync-scheduler")
    _thread.start()
    logger.info("[scheduler] auto-sync scheduler started (checks every 30 min)")
