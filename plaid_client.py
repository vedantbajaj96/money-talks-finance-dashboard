"""
plaid_client.py — Plaid API wrapper for MoneyTalks.

Sync strategy — cursor-based incremental sync:
  - First sync per institution (no cursor): full history pulled once, cursor saved.
  - Subsequent syncs: only added/modified/removed since last cursor — fast.
  - Historical months are never re-fetched. Only current-month deltas come in.
  - /transactions/refresh forces the bank to push the latest data before syncing.

Public API:
  is_configured(cfg)                   — True if credentials are set
  create_link_token(cfg)               — start Plaid Link flow
  exchange_and_save(public_token, ...) — save access_token after Link completes
  get_connected_accounts(data_dir)     — list linked institutions
  get_account_balances(cfg, data_dir)  — live balance fetch (net worth)
  remove_account(item_id, data_dir)    — unlink an institution
  refresh_all(cfg, data_dir)           — force banks to push latest data
  sync_all_transactions(existing_df, cfg, data_dir) — incremental delta sync

All functions accept:
  cfg      — dict with plaid_client_id / plaid_secret / plaid_environment.
             Falls back to the global data/config.json if not passed.
  data_dir — path to the user's data directory (for plaid_items.json).
             Falls back to the module-level data/ directory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import plaid
from plaid.api import plaid_api
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_refresh_request import TransactionsRefreshRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest

# Default data directory (module-level fallback; per-user callers pass data_dir explicitly)
_MODULE_DIR  = Path(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DATA_DIR  = _MODULE_DIR / "data"
_DEFAULT_CFG_FILE  = _MODULE_DIR / "config.json"

_ENV_MAP = {
    "sandbox":    plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _default_cfg() -> dict:
    """Load the global config.json as a fallback when no cfg is passed."""
    if _DEFAULT_CFG_FILE.exists():
        try:
            return json.loads(_DEFAULT_CFG_FILE.read_text())
        except Exception:
            pass
    return {}


def _items_file(data_dir: str | None) -> Path:
    base = Path(data_dir) if data_dir else _DEFAULT_DATA_DIR
    return base / "plaid_items.json"


def _get_api_client(cfg: dict | None = None) -> plaid_api.PlaidApi:
    if cfg is None:
        cfg = _default_cfg()
    client_id = cfg.get("plaid_client_id") or os.environ.get("PLAID_CLIENT_ID", "")
    secret    = cfg.get("plaid_secret")     or os.environ.get("PLAID_SECRET", "")
    env_name  = cfg.get("plaid_environment", "sandbox")

    configuration = plaid.Configuration(
        host=_ENV_MAP.get(env_name, plaid.Environment.Sandbox),
        api_key={"clientId": client_id, "secret": secret},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def _load_items(data_dir: str | None = None) -> list[dict]:
    f = _items_file(data_dir)
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text())
        items = data.get("items", [])
        # Guard against accidental double-nesting: {"items": {"items": [...]}}
        if isinstance(items, dict):
            items = items.get("items", [])
        return items if isinstance(items, list) else []
    except Exception:
        return []


def _save_items(items: list[dict], data_dir: str | None = None) -> None:
    f = _items_file(data_dir)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"items": items}, indent=2))


def _fetch_delta(
    client: plaid_api.PlaidApi,
    access_token: str,
    cursor: str | None,
) -> tuple[list, list, list, str]:
    """
    Paginate /transactions/sync from the given cursor (or start if None).
    Returns (added, modified, removed, next_cursor).
    """
    added, modified, removed = [], [], []
    has_more    = True
    next_cursor = cursor

    while has_more:
        kwargs: dict = {"access_token": access_token}
        if next_cursor:
            kwargs["cursor"] = next_cursor

        response = client.transactions_sync(TransactionsSyncRequest(**kwargs))
        # Use attribute access + to_dict() — SDK returns model objects, not dicts
        added    += [t.to_dict() for t in response.added]
        modified += [t.to_dict() for t in response.modified]
        removed  += [t.to_dict() for t in response.removed]
        has_more    = response.has_more
        next_cursor = response.next_cursor

    return added, modified, removed, next_cursor


def _row_from_txn(txn: dict, inst_name: str, item_id: str) -> dict:
    merchant = txn.get("merchant_name") or txn.get("name") or ""
    date_str = txn.get("date") or txn.get("settlement_date") or ""
    amount   = txn.get("amount") or txn.get("quantity") or 0.0
    txn_id   = txn.get("transaction_id") or txn.get("investment_transaction_id") or ""
    return {
        "date":               pd.to_datetime(str(date_str)),
        "description":        str(merchant).strip(),
        "expense_amount":     float(amount),
        "source":             f"Plaid – {inst_name}",
        "format":             "plaid",
        "source_file":        f"plaid_{item_id}",
        "plaid_txn_id":       txn_id,
        "category":           None,
        "suggested_category": None,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def is_configured(cfg: dict | None = None) -> bool:
    if cfg is None:
        cfg = _default_cfg()
    return bool(cfg.get("plaid_client_id")) and bool(cfg.get("plaid_secret"))


def create_link_token(cfg: dict | None = None, redirect_uri: str | None = None) -> str:
    """
    Create a Plaid Link token.

    OAuth institutions (AMEX, Chase, BofA, Capital One) require redirect_uri to be set
    AND registered in your Plaid dashboard (Developers → API → Allowed Redirect URIs).
    In production this must be an HTTPS URL — localhost won't work.
    Pass redirect_uri explicitly, or set plaid_redirect_uri in config.
    """
    if cfg is None:
        cfg = _default_cfg()
    env_name = cfg.get("plaid_environment", "sandbox")
    client   = _get_api_client(cfg)

    # Resolve redirect_uri: explicit arg > config value > sandbox default
    if redirect_uri is None:
        redirect_uri = cfg.get("plaid_redirect_uri") or (
            "http://localhost:8502/oauth_callback" if env_name == "sandbox" else None
        )

    kwargs = dict(
        user=LinkTokenCreateRequestUser(client_user_id="local-user"),
        client_name="MoneyTalks",
        products=[Products("transactions"), Products("investments")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    if redirect_uri:
        kwargs["redirect_uri"] = redirect_uri

    response = client.link_token_create(LinkTokenCreateRequest(**kwargs))
    return response["link_token"]


def exchange_and_save(
    public_token: str,
    institution_name: str,
    cfg: dict | None = None,
    data_dir: str | None = None,
) -> None:
    """Exchange a one-time public_token for a permanent access_token and persist it."""
    client   = _get_api_client(cfg)
    response = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    new_item = {
        "access_token":     response["access_token"],
        "item_id":          response["item_id"],
        "institution_name": institution_name,
        "cursor":           None,
    }
    items = [i for i in _load_items(data_dir) if i.get("institution_name") != institution_name]
    items.append(new_item)
    _save_items(items, data_dir)


def get_connected_accounts(data_dir: str | None = None) -> list[dict]:
    return [
        {"institution_name": i["institution_name"], "item_id": i["item_id"]}
        for i in _load_items(data_dir)
    ]


def get_account_balances(cfg: dict | None = None, data_dir: str | None = None) -> list[dict]:
    """Live balance fetch for net worth display."""
    client  = _get_api_client(cfg)
    results = []

    for item in _load_items(data_dir):
        try:
            response = client.accounts_balance_get(
                AccountsBalanceGetRequest(access_token=item["access_token"])
            )
            for acct in response.accounts:
                balances = acct.balances
                results.append({
                    "institution_name":  item.get("institution_name", "Unknown"),
                    "account_name":      acct.name or "Account",
                    "account_type":      str(acct.type),
                    "current_balance":   float(balances.current or 0),
                    "available_balance": float(balances.available) if balances.available is not None else None,
                })
        except Exception:
            continue

    return results


def remove_account(item_id: str, data_dir: str | None = None) -> None:
    items = [i for i in _load_items(data_dir) if i.get("item_id") != item_id]
    _save_items(items, data_dir)


def refresh_all(cfg: dict | None = None, data_dir: str | None = None) -> list[str]:
    """
    Call /transactions/refresh for every connected institution.
    Tells Plaid to pull the latest data from the bank right now,
    so the subsequent sync gets the most current transactions.
    Returns a list of error strings (empty on full success).
    """
    client = _get_api_client(cfg)
    errors = []

    for item in _load_items(data_dir):
        try:
            client.transactions_refresh(
                TransactionsRefreshRequest(access_token=item["access_token"])
            )
        except Exception as exc:
            # Investment-only items (e.g. Wealthfront) don't support /refresh — expected
            err_str = str(exc)
            if "PRODUCTS_NOT_SUPPORTED" not in err_str and "NO_ACCOUNTS" not in err_str:
                errors.append(f"{item.get('institution_name', 'Unknown')}: {exc}")

    return errors


def sync_all_transactions(
    existing_df: pd.DataFrame | None = None,
    cfg: dict | None = None,
    data_dir: str | None = None,
) -> tuple[pd.DataFrame, list[str], dict]:
    """
    Incremental delta sync across all connected institutions.

    Strategy per institution:
      - cursor=None (first ever sync): full history pulled once, replaces any
        existing rows for that institution, cursor saved for next time.
      - cursor exists: only added/modified/removed since last sync returned.
        Old months are never re-fetched.

    Args:
      existing_df: the current stored transactions DataFrame (with categories,
                   notes, tags etc.). Delta is applied on top of this.
      cfg:         Plaid API credentials dict.
      data_dir:    path to directory containing plaid_items.json.

    Returns:
      (updated_df, errors, stats)
        updated_df — existing_df with delta applied; new rows have category=None
        errors     — per-institution error strings
        stats      — {"added": N, "modified": M, "removed": R}
    """
    items = _load_items(data_dir)
    if not items:
        empty = existing_df if existing_df is not None else pd.DataFrame()
        return empty, [], {"added": 0, "modified": 0, "removed": 0}

    client = _get_api_client(cfg)
    df     = existing_df.copy() if existing_df is not None and not existing_df.empty else pd.DataFrame()
    errors = []
    total_added = total_modified = total_removed = 0

    for idx, item in enumerate(items):
        access_token = item["access_token"]
        inst_name    = item.get("institution_name", "Plaid")
        cursor       = item.get("cursor")
        inst_source  = f"Plaid – {inst_name}"

        try:
            added, modified, removed, next_cursor = _fetch_delta(client, access_token, cursor)
        except Exception as exc:
            errors.append(f"{inst_name}: {exc}")
            continue

        # First sync: save user annotations before dropping old rows so we can restore them
        saved_annotations: dict[str, dict] = {}
        if cursor is None and not df.empty and "source" in df.columns:
            old_rows = df[df["source"] == inst_source]
            if "plaid_txn_id" in old_rows.columns:
                for _, r in old_rows.iterrows():
                    tid = r.get("plaid_txn_id")
                    if tid:
                        saved_annotations[str(tid)] = {
                            "category":    r.get("category"),
                            "notes":       r.get("notes"),
                            "tags":        r.get("tags"),
                            "user_edited": bool(r.get("user_edited", False)),
                        }
            df = df[df["source"] != inst_source].copy()

        # Apply removals
        if removed and not df.empty and "plaid_txn_id" in df.columns:
            remove_ids = {r["transaction_id"] for r in removed}
            df = df[~df["plaid_txn_id"].isin(remove_ids)].copy()
        total_removed += len(removed)

        # Apply modifications (amount/description only; never touch user-edited categories)
        if modified and not df.empty and "plaid_txn_id" in df.columns:
            has_user_edited = "user_edited" in df.columns
            for txn in modified:
                mask = df["plaid_txn_id"] == txn["transaction_id"]
                if mask.any():
                    merchant = txn.get("merchant_name") or txn.get("name", "")
                    df.loc[mask, "expense_amount"] = float(txn["amount"])
                    df.loc[mask, "description"]    = merchant.strip()
        total_modified += len(modified)

        # Apply additions
        if added:
            new_rows = [_row_from_txn(t, inst_name, item["item_id"]) for t in added]
            new_df   = pd.DataFrame(new_rows)
            # Restore annotations from before the full resync
            if saved_annotations:
                for col in ["notes", "tags", "user_edited"]:
                    if col not in new_df.columns:
                        new_df[col] = False if col == "user_edited" else None
                for i, row in new_df.iterrows():
                    tid = str(row.get("plaid_txn_id") or "")
                    if tid not in saved_annotations:
                        continue
                    ann = saved_annotations[tid]
                    was_user_edited = ann.get("user_edited", False)
                    if was_user_edited or ann.get("category"):
                        new_df.at[i, "category"] = ann["category"]
                    if ann.get("notes"):
                        new_df.at[i, "notes"] = ann["notes"]
                    if ann.get("tags"):
                        new_df.at[i, "tags"] = ann["tags"]
                    if was_user_edited:
                        new_df.at[i, "user_edited"] = True
            df = pd.concat([df, new_df], ignore_index=True) if not df.empty else new_df
        total_added += len(added)

        # Persist cursor immediately so a crash mid-loop doesn't lose progress
        items[idx]["cursor"] = next_cursor
        _save_items(items, data_dir)

    stats = {"added": total_added, "modified": total_modified, "removed": total_removed}
    return df, errors, stats
