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


def _snapshot_investments_user(username: str) -> None:
    try:
        import json
        from core.store import load_config, save_config, user_dir
        from core.plaid_client import get_investment_data, is_configured

        cfg = load_config(username)
        if not is_configured(cfg):
            return

        data = get_investment_data(cfg=cfg, data_dir=str(user_dir(username)))
        total = sum(h["value"] for h in data.get("holdings", []))
        if total <= 0:
            return

        snap_path = user_dir(username) / "investment_snapshots.json"
        snapshots = json.loads(snap_path.read_text()) if snap_path.exists() else []
        today = datetime.date.today().isoformat()
        snapshots = [s for s in snapshots if s["date"] != today]
        snapshots.append({"date": today, "value": total})
        cutoff = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
        snapshots = sorted([s for s in snapshots if s["date"] >= cutoff], key=lambda s: s["date"])
        snap_path.write_text(json.dumps(snapshots))

        cfg["last_investment_snapshot"] = today
        save_config(username, cfg)
        logger.info("[scheduler:%s] investment snapshot saved — total=%.2f", username, total)
    except Exception as exc:
        logger.error("[scheduler:%s] investment snapshot failed: %s", username, exc, exc_info=True)


def _loop() -> None:
    while True:
        time.sleep(43200)  # check every 12 hours
        try:
            from core.store import list_users, load_config
            for username in list_users():
                try:
                    cfg = load_config(username)

                    # --- transaction auto-sync ---
                    interval_hours = int(cfg.get("auto_sync_interval", 0))
                    if interval_hours:
                        last_sync = cfg.get("last_sync")
                        run_sync = True
                        if last_sync:
                            last_dt = datetime.datetime.fromisoformat(last_sync.replace("Z", ""))
                            elapsed = (datetime.datetime.utcnow() - last_dt).total_seconds() / 3600
                            run_sync = elapsed >= interval_hours
                        if run_sync:
                            logger.info("[scheduler:%s] triggering auto-sync (interval=%dh)", username, interval_hours)
                            _sync_user(username)

                    # --- daily investment snapshot ---
                    if cfg.get("auto_investment_snapshot"):
                        today = datetime.date.today().isoformat()
                        if cfg.get("last_investment_snapshot") != today:
                            logger.info("[scheduler:%s] triggering daily investment snapshot", username)
                            _snapshot_investments_user(username)

                except Exception as exc:
                    logger.error("[scheduler:%s] error: %s", username, exc)
        except Exception as exc:
            logger.error("[scheduler] loop error: %s", exc)
        # Run notification agents after each 12-hour cycle
        _check_market_alerts()


def _ai_summary(prompt: str, api_key: str, provider: str = "claude") -> str:
    """Generate a short AI summary. Returns empty string on failure."""
    try:
        if provider == "claude":
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip()
        elif provider == "gemini":
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            return model.generate_content(prompt).text.strip()
    except Exception as e:
        logger.warning("[scheduler] AI summary failed: %s", e)
    return ""


def _check_market_alerts() -> None:
    """Run all notification agents: market drop, portfolio drop, daily brief, monthly digest."""
    try:
        import yfinance as yf
        import json
        from core.store import list_users, load_config, save_config, user_dir
        from core.notifier import (
            send_market_drop_alert, send_portfolio_drop_alert,
            send_daily_brief, send_monthly_digest,
        )

        today      = datetime.date.today().isoformat()
        today_dt   = datetime.date.today()
        month_key  = today[:7]  # YYYY-MM
        hour_now   = datetime.datetime.now().hour

        # ── Fetch market data once for all users ──
        tickers = ["SPY", "QQQ", "VTI", "XLK", "XLF", "XLE", "XLV"]
        market_data: dict = {}
        spy_day_pct: float | None = None
        spy_prev_close: float | None = None

        try:
            raw = yf.download(tickers, period="5d", interval="1d", progress=False, auto_adjust=True)
            close = raw["Close"]
            if hasattr(close, "columns"):
                for ticker in tickers:
                    if ticker in close.columns:
                        col = close[ticker].dropna()
                        if len(col) >= 2:
                            prev = float(col.iloc[-2])
                            last = float(col.iloc[-1])
                            last_date = col.index[-1].date().isoformat()
                            if last_date == today:
                                pct = (last - prev) / prev * 100
                                market_data[ticker] = {"price": last, "change_pct": pct}
                                if ticker == "SPY":
                                    spy_day_pct   = pct
                                    spy_prev_close = prev
        except Exception as e:
            logger.warning("[scheduler] market data fetch failed: %s", e)

        for username in list_users():
            try:
                cfg        = load_config(username)
                email      = cfg.get("alert_email", "").strip()
                # Sender is the admin's MoneyTalks Gmail; falls back to self-send if not set
                from_email = cfg.get("alert_from_email", "").strip() or None
                smtp_pass  = cfg.get("alert_smtp_password", "").strip()
                if not email or not smtp_pass:
                    continue

                api_key  = cfg.get("anthropic_api_key") or cfg.get("gemini_api_key", "")
                provider = cfg.get("preferred_provider", "claude")

                # ── Agent 1: Market drop alert ──
                drop_threshold = float(cfg.get("market_drop_threshold", 1.5))
                if cfg.get("notify_market_drop") and spy_day_pct is not None and spy_day_pct <= -drop_threshold:
                    if cfg.get("last_market_alert_date") != today:
                        send_market_drop_alert(
                            to=email, smtp_password=smtp_pass, from_email=from_email,
                            ticker="SPY", drop_pct=abs(spy_day_pct),
                            threshold_pct=drop_threshold,
                            price=market_data.get("SPY", {}).get("price", 0),
                        )
                        cfg["last_market_alert_date"] = today
                        save_config(username, cfg)

                # ── Agent 2: Portfolio drop alert ──
                port_threshold = float(cfg.get("portfolio_drop_threshold", 3.0))
                if not cfg.get("notify_portfolio_drop"):
                    port_threshold = None  # skip
                snap_path = user_dir(username) / "investment_snapshots.json"
                if port_threshold is not None and snap_path.exists():
                    snapshots = json.loads(snap_path.read_text())
                    if len(snapshots) >= 2:
                        yesterday_snap = snapshots[-2]
                        today_snap     = snapshots[-1] if snapshots[-1]["date"] == today else None
                        if today_snap:
                            prev_val = yesterday_snap["value"]
                            curr_val = today_snap["value"]
                            if prev_val > 0:
                                port_drop_pct = (prev_val - curr_val) / prev_val * 100
                                if port_drop_pct >= port_threshold:
                                    if cfg.get("last_portfolio_alert_date") != today:
                                        send_portfolio_drop_alert(
                                            to=email, smtp_password=smtp_pass, from_email=from_email,
                                            drop_pct=port_drop_pct,
                                            threshold_pct=port_threshold,
                                            current_value=curr_val,
                                            prev_value=prev_val,
                                        )
                                        cfg["last_portfolio_alert_date"] = today
                                        save_config(username, cfg)

                # ── Agent 3: Daily market brief (send between 7–10am) ──
                if cfg.get("daily_brief_enabled") and 7 <= hour_now <= 10:
                    if cfg.get("last_daily_brief_date") != today and market_data:
                        summary = ""
                        if api_key:
                            lines = ", ".join(
                                f"{t}: {d['change_pct']:+.2f}%"
                                for t, d in market_data.items()
                            )
                            prompt = (
                                f"Today's market data: {lines}. "
                                "Write a 3-sentence plain-English summary of what happened in the market today. "
                                "Be factual, concise, and mention any notable sector moves. No disclaimers."
                            )
                            summary = _ai_summary(prompt, api_key, provider)
                        if not summary:
                            spy_d = market_data.get("SPY", {})
                            sign = "up" if spy_d.get("change_pct", 0) >= 0 else "down"
                            summary = f"SPY closed {sign} {abs(spy_d.get('change_pct', 0)):.2f}% today."

                        send_daily_brief(
                            to=email, smtp_password=smtp_pass, from_email=from_email,
                            market_data=market_data, ai_summary=summary,
                        )
                        cfg["last_daily_brief_date"] = today
                        save_config(username, cfg)

                # ── Agent 4: Monthly portfolio digest (1st of month) ──
                if cfg.get("monthly_digest_enabled") and today_dt.day == 1:
                    if cfg.get("last_digest_month") != month_key and snap_path.exists():
                        snapshots = json.loads(snap_path.read_text())
                        if len(snapshots) >= 2:
                            curr_val = snapshots[-1]["value"]
                            prev_val = snapshots[-2]["value"]
                            port_chg     = curr_val - prev_val
                            port_chg_pct = (port_chg / prev_val * 100) if prev_val > 0 else 0
                            spy_chg_pct  = market_data.get("SPY", {}).get("change_pct", 0)
                            # Fee from last month's statement
                            fee_this_month = 0.0
                            try:
                                from routes.portfolio_routes import _parse_statements, _statements_dir
                                prev_month = (today_dt.replace(day=1) - datetime.timedelta(days=1)).strftime("%Y-%m")
                                stmts = _parse_statements(_statements_dir(cfg))
                                for s in stmts:
                                    if s["month"] == prev_month:
                                        fee_this_month = s["fee"]
                                        break
                            except Exception:
                                pass

                            summary = ""
                            if api_key:
                                prompt = (
                                    f"My investment portfolio last month: "
                                    f"value ${curr_val:,.0f}, changed {port_chg_pct:+.1f}% vs SPY {spy_chg_pct:+.1f}%. "
                                    f"Advisory fee: ${fee_this_month:.2f}. "
                                    "Write a 3-sentence personal financial summary of how the month went. "
                                    "Be encouraging but honest. No disclaimers."
                                )
                                summary = _ai_summary(prompt, api_key, provider)
                            if not summary:
                                summary = f"Your portfolio {'grew' if port_chg >= 0 else 'fell'} {abs(port_chg_pct):.1f}% last month."

                            send_monthly_digest(
                                to=email, smtp_password=smtp_pass, from_email=from_email,
                                month_label=datetime.date.today().strftime("%B %Y"),
                                portfolio_value=curr_val,
                                portfolio_change=port_chg,
                                portfolio_change_pct=port_chg_pct,
                                spy_change_pct=spy_chg_pct,
                                fees_this_month=fee_this_month,
                                ai_summary=summary,
                            )
                            cfg["last_digest_month"] = month_key
                            save_config(username, cfg)

            except Exception as exc:
                logger.error("[scheduler:%s] notification agent error: %s", username, exc)

    except Exception as exc:
        logger.error("[scheduler] _check_market_alerts failed: %s", exc)


def start() -> None:
    global _thread
    if _thread is not None:
        return
    _thread = threading.Thread(target=_loop, daemon=True, name="auto-sync-scheduler")
    _thread.start()
    # Run market alerts check shortly after startup
    threading.Thread(target=_check_market_alerts, daemon=True, name="market-alert-startup").start()
    logger.info("[scheduler] auto-sync scheduler started")
