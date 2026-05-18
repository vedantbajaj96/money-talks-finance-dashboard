"""
core/fin_data.py — build_fin_data: assembles the full /api/fin JSON payload.

This is the core read path: parquet → structured dict the React frontend consumes.
Importing this module has no side effects beyond standard library imports.
"""
from __future__ import annotations

import datetime
import hashlib

import pandas as pd

from core.store import get_conn, data_file, user_dir, load_config, load_splits
from core.categories import map_category, _resolve_category, CAT_META, ACCOUNT_COLORS


def _month_labels(key: str) -> tuple[str, str, str]:
    """'2024-03' → ('Mar 2024', 'Mar', 'Mar 24')"""
    dt = datetime.date(int(key[:4]), int(key[5:7]), 1)
    return dt.strftime("%b %Y"), dt.strftime("%b"), dt.strftime("%b %y")


def build_fin_data(username: str) -> dict:
    conn = get_conn(username)

    # ── MONTHS ────────────────────────────────────────────────────────────
    month_keys = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT strftime(date, '%Y-%m') AS m FROM txns ORDER BY m"
        ).fetchall()
    ]
    months = [
        {"key": k, "label": _month_labels(k)[0], "short": _month_labels(k)[1]}
        for k in month_keys
    ]

    # ── ACCOUNTS ──────────────────────────────────────────────────────────
    plaid_balances: dict[str, dict] = {}
    try:
        from core.plaid_client import get_account_balances, is_configured
        cfg = load_config(username)
        if is_configured(cfg):
            data_dir = str(user_dir(username))
            for b in get_account_balances(cfg=cfg, data_dir=data_dir):
                inst      = b["institution_name"]
                key       = f"Plaid – {inst}"
                acct_type = b["account_type"]
                bal       = float(b["current_balance"] or 0)
                signed_bal = -bal if acct_type in ("credit", "loan") else bal
                if key not in plaid_balances:
                    plaid_balances[key] = {"balance": 0.0, "acct_types": set()}
                plaid_balances[key]["balance"] += signed_bal
                plaid_balances[key]["acct_types"].add(acct_type)
    except Exception:
        pass

    sources = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT source FROM txns ORDER BY source"
        ).fetchall()
    ]
    accounts = [
        {
            "id":      s,
            "name":    s,
            "inst":    s,
            "type":    "credit" if plaid_balances.get(s, {}).get("balance", 0.0) < 0 else "checking",
            "last4":   "????",
            "balance": plaid_balances.get(s, {}).get("balance", 0.0),
            "color":   ACCOUNT_COLORS[i % len(ACCOUNT_COLORS)],
        }
        for i, s in enumerate(sources)
    ]

    # Investment-only accounts (e.g. Wealthfront) have no transactions so they
    # never appear in sources. Add them from the Plaid balance fetch directly.
    source_set = set(sources)
    for j, (key, pb) in enumerate(plaid_balances.items()):
        if key not in source_set:
            acct_types = pb.get("acct_types", set())
            atype = "investment" if "investment" in acct_types else ("credit" if pb["balance"] < 0 else "checking")
            inst_name = key.removeprefix("Plaid – ")
            accounts.append({
                "id":      key,
                "name":    key,
                "inst":    inst_name,
                "type":    atype,
                "last4":   "????",
                "balance": pb["balance"],
                "color":   ACCOUNT_COLORS[(len(sources) + j) % len(ACCOUNT_COLORS)],
            })

    # ── CATEGORIES ────────────────────────────────────────────────────────
    raw_cats = [
        r[0] for r in conn.execute("SELECT DISTINCT category FROM txns").fetchall()
    ]
    seen_cat_ids: set[str] = {"income"}
    dynamic_cats: dict[str, dict] = {}
    for raw_cat in raw_cats:
        cat_id = map_category(str(raw_cat))
        seen_cat_ids.add(cat_id)
        if cat_id not in CAT_META:
            dynamic_cats[cat_id] = {
                "name": str(raw_cat), "group": "variable",
                "color": "#94a3b8", "icon": "○",
            }
    all_meta = {**CAT_META, **dynamic_cats}
    categories = [{"id": k, **v} for k, v in all_meta.items()]

    # ── TRANSACTIONS ──────────────────────────────────────────────────────
    col_names = {r[0] for r in conn.execute("DESCRIBE txns").fetchall()}
    select_txn_id    = "txn_id"            if "txn_id"            in col_names else "NULL"
    select_notes     = "notes"             if "notes"             in col_names else "NULL"
    select_tags      = "tags"              if "tags"              in col_names else "NULL"
    select_txn_type   = "transaction_type"  if "transaction_type"  in col_names else "NULL"
    select_user_edit  = "user_edited"       if "user_edited"       in col_names else "FALSE"
    select_source_type = "source_type"      if "source_type"       in col_names else "NULL"

    rows = conn.execute(f"""
        SELECT
            date, description, expense_amount, category, source,
            {select_txn_id}     AS txn_id,
            {select_notes}      AS notes,
            {select_tags}       AS tags,
            {select_txn_type}   AS txn_type,
            {select_user_edit}  AS user_edited,
            {select_source_type} AS source_type
        FROM txns
        ORDER BY date DESC
    """).fetchall()

    # Pre-build approved / user_edited sets for confidence scoring
    try:
        _conf_df = pd.read_parquet(data_file(username), columns=["txn_id", "approved", "user_edited"])
        _approved_ids    = set(_conf_df.loc[_conf_df["approved"].fillna(False).infer_objects(copy=False).astype(bool), "txn_id"].dropna())
        _user_edited_ids = set(_conf_df.loc[_conf_df["user_edited"].fillna(False).infer_objects(copy=False).astype(bool), "txn_id"].dropna())
    except Exception:
        _approved_ids    = set()
        _user_edited_ids = set()

    transactions = []
    for date, desc, expense_amount, category, source, txn_id, notes, tags, txn_type, user_edited, source_type in rows:
        if not txn_id:
            txn_id = hashlib.md5(
                f"{date}|{desc}|{expense_amount}".encode()
            ).hexdigest()[:12]
        if user_edited:
            # User manually set this category — respect it exactly, no auto-overrides
            from core.categories import map_category as _mc
            cat_id = _mc(str(category or "other"))
        else:
            cat_id = _resolve_category(str(desc), str(category or "other"), txn_type, float(expense_amount or 0))
        _tid = str(txn_id)
        if _tid in _approved_ids or _tid in _user_edited_ids:
            _conf = "high"
        elif cat_id in ("other", "uncategorized"):
            _conf = "low"
        else:
            _conf = "medium"

        transactions.append({
            "id":          _tid,
            "date":        str(date)[:10],
            "merchant":    str(desc),
            "category":    cat_id,
            "amount":      round(-float(expense_amount), 2),
            "account":     str(source or ""),
            "pending":     False,
            "notes":       str(notes or ""),
            "tags":        str(tags or ""),
            "confidence":  _conf,
            "source_type": str(source_type or ""),
        })

    # ── APPLY SPLITS ──────────────────────────────────────────────────────
    splits_data = load_splits(username)
    if splits_data:
        expanded = []
        for t in transactions:
            if t["id"] in splits_data:
                parts = splits_data[t["id"]]
                for i, s in enumerate(parts):
                    expanded.append({
                        **t,
                        "id":          f"{t['id']}_s{i}",
                        "category":    s["category"],
                        "amount":      round(float(s["amount"]), 2),
                        "notes":       s.get("notes", ""),
                        "is_split":    True,
                        "parent_id":   t["id"],
                        "split_label": f"{s.get('notes', '') or s['category']} ({i+1}/{len(parts)})",
                    })
            else:
                expanded.append(t)
        transactions = expanded

    # ── NET WORTH HISTORY ─────────────────────────────────────────────────
    if "transaction_type" in col_names:
        _nw_inc = "CASE WHEN transaction_type = 'income'  THEN ABS(expense_amount) ELSE 0 END"
        _nw_exp = "CASE WHEN transaction_type = 'expense' THEN expense_amount       ELSE 0 END"
    else:
        _nw_inc = "CASE WHEN expense_amount < 0 THEN ABS(expense_amount) ELSE 0 END"
        _nw_exp = "CASE WHEN expense_amount > 0 THEN expense_amount       ELSE 0 END"

    nw_rows = conn.execute(f"""
        WITH monthly AS (
            SELECT
                strftime(date, '%Y-%m') AS month,
                SUM({_nw_inc}) AS inc,
                SUM({_nw_exp}) AS exp
            FROM txns
            GROUP BY month
        )
        SELECT
            month,
            SUM(inc - exp) OVER (ORDER BY month) AS running_net
        FROM monthly
        ORDER BY month
    """).fetchall()

    nw_history = [
        {
            "month":       _month_labels(r[0])[2],
            "assets":      round(max(float(r[1]), 0), 2),
            "liabilities": round(max(-float(r[1]), 0), 2),
        }
        for r in nw_rows
    ]

    # ── RECURRING ─────────────────────────────────────────────────────────
    recurring = []
    try:
        import calendar as _cal
        from core.subscriptions import detect_recurring
        df = pd.read_parquet(data_file(username))
        rec_df = detect_recurring(df)
        if not rec_df.empty:
            today = datetime.date.today()
            for _, row in rec_df.iterrows():
                cat_id  = map_category(str(row.get("category", "other")))
                matches = df[df["description"] == row["description"]]
                freq    = str(row.get("frequency", "Monthly"))
                last    = row.get("last_charge")

                if last is None:
                    last_date = today
                elif hasattr(last, "date"):
                    last_date = last.date()
                elif hasattr(last, "year"):
                    last_date = last
                else:
                    try:
                        last_date = datetime.date.fromisoformat(str(last))
                    except Exception:
                        last_date = today

                try:
                    if freq == "Weekly":
                        next_date = last_date + datetime.timedelta(days=7)
                    elif freq == "Bi-weekly":
                        next_date = last_date + datetime.timedelta(days=14)
                    elif freq == "Monthly":
                        m = last_date.month % 12 + 1
                        y = last_date.year + (1 if last_date.month == 12 else 0)
                        d = min(last_date.day, _cal.monthrange(y, m)[1])
                        next_date = datetime.date(y, m, d)
                    elif freq == "Quarterly":
                        next_date = last_date + datetime.timedelta(days=91)
                    elif freq == "Annual":
                        try:
                            next_date = datetime.date(last_date.year + 1, last_date.month, last_date.day)
                        except ValueError:
                            next_date = datetime.date(last_date.year + 1, last_date.month, last_date.day - 1)
                    else:
                        next_date = last_date + datetime.timedelta(days=30)

                    while next_date < today:
                        if freq == "Weekly":
                            next_date += datetime.timedelta(days=7)
                        elif freq == "Bi-weekly":
                            next_date += datetime.timedelta(days=14)
                        else:
                            next_date += datetime.timedelta(days=30)
                except Exception:
                    next_date = today + datetime.timedelta(days=30)

                recurring.append({
                    "merchant":    str(row["description"]),
                    "category":    cat_id,
                    "amount":      float(row["amount"]),
                    "freq":        freq,
                    "account":     str(matches["source"].iloc[0]) if not matches.empty else "",
                    "next":        next_date.isoformat(),
                    "day":         next_date.day,
                    "occurrences": int(row.get("occurrences", 0)),
                    "est_monthly": float(row.get("est_monthly_cost", float(row["amount"]))),
                    "last_charge": last_date.isoformat(),
                })
    except Exception:
        pass

    return {
        "hasData":           True,
        "ACCOUNTS":          accounts,
        "CATEGORIES":        categories,
        "MONTHS":            months,
        "TRANSACTIONS":      transactions,
        "RECURRING":         recurring,
        "NET_WORTH_HISTORY": nw_history,
    }
