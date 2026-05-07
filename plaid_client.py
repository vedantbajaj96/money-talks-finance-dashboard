"""
plaid_client.py — Plaid API wrapper for the Finance Dashboard.

Sync strategy — cursor-based incremental sync:
  - First sync per institution (no cursor): full history pulled once, cursor saved.
  - Subsequent syncs: only added/modified/removed since last cursor — fast.
  - Historical months are never re-fetched. Only current-month deltas come in.
  - /transactions/refresh forces the bank to push the latest data before syncing.

Public API:
  is_configured()            — True if credentials are set
  create_link_token()        — start Plaid Link flow
  exchange_and_save()        — save access_token after Link completes
  get_connected_accounts()   — list linked institutions
  get_account_balances()     — live balance fetch (net worth)
  remove_account(item_id)    — unlink an institution
  refresh_all()              — force banks to push latest data (call before sync)
  sync_all_transactions(existing_df) — incremental delta sync, returns (df, errors, stats)
"""

from __future__ import annotations

import json
import os

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

from config import load_config

_DATA_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_ITEMS_FILE = os.path.join(_DATA_DIR, "plaid_items.json")

_ENV_MAP = {
    "sandbox":    plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_api_client() -> plaid_api.PlaidApi:
    cfg       = load_config()
    client_id = cfg.get("plaid_client_id") or os.environ.get("PLAID_CLIENT_ID", "")
    secret    = cfg.get("plaid_secret")     or os.environ.get("PLAID_SECRET", "")
    env_name  = cfg.get("plaid_environment", "sandbox")

    configuration = plaid.Configuration(
        host=_ENV_MAP.get(env_name, plaid.Environment.Sandbox),
        api_key={"clientId": client_id, "secret": secret},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def _load_items() -> list[dict]:
    if not os.path.exists(_ITEMS_FILE):
        return []
    try:
        with open(_ITEMS_FILE) as f:
            return json.load(f).get("items", [])
    except Exception:
        return []


def _save_items(items: list[dict]) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_ITEMS_FILE, "w") as f:
        json.dump({"items": items}, f, indent=2)


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
    has_more     = True
    next_cursor  = cursor

    while has_more:
        kwargs: dict = {"access_token": access_token}
        if next_cursor:
            kwargs["cursor"] = next_cursor

        response = client.transactions_sync(TransactionsSyncRequest(**kwargs))
        # Use attribute access + to_dict() so this works regardless of whether
        # the SDK returns model objects or dict-like objects (varies by account type)
        added    += [t.to_dict() for t in response.added]
        modified += [t.to_dict() for t in response.modified]
        removed  += [t.to_dict() for t in response.removed]
        has_more    = response.has_more
        next_cursor = response.next_cursor

    return added, modified, removed, next_cursor


def _row_from_txn(txn: dict, inst_name: str, item_id: str) -> dict:
    merchant = txn.get("merchant_name") or txn.get("name") or ""
    # Investment transactions use "date" or "settlement_date"; regular use "date"
    date_str = txn.get("date") or txn.get("settlement_date") or ""
    # Plaid signs: positive = money out (expense), negative = money in (income)
    # investment transactions use "amount" too
    amount = txn.get("amount") or txn.get("quantity") or 0.0
    txn_id = txn.get("transaction_id") or txn.get("investment_transaction_id") or ""
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

def is_configured() -> bool:
    cfg = load_config()
    return bool(cfg.get("plaid_client_id")) and bool(cfg.get("plaid_secret"))


def create_link_token() -> str:
    """
    redirect_uri only passed in sandbox (http://localhost allowed).
    Production omits it — OAuth banks need HTTPS which localhost can't provide.
    """
    cfg      = load_config()
    env_name = cfg.get("plaid_environment", "sandbox")
    client   = _get_api_client()

    kwargs = dict(
        user=LinkTokenCreateRequestUser(client_user_id="local-user"),
        client_name="Finance Dashboard",
        products=[Products("transactions"), Products("investments")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    if env_name == "sandbox":
        kwargs["redirect_uri"] = "http://localhost:8502/oauth_callback"

    response = client.link_token_create(LinkTokenCreateRequest(**kwargs))
    return response["link_token"]


def exchange_and_save(public_token: str, institution_name: str) -> None:
    """Exchange a one-time public_token for a permanent access_token and persist it."""
    client   = _get_api_client()
    response = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    new_item = {
        "access_token":     response["access_token"],
        "item_id":          response["item_id"],
        "institution_name": institution_name,
        "cursor":           None,  # no cursor yet — first sync will be a full pull
    }
    items = [i for i in _load_items() if i.get("institution_name") != institution_name]
    items.append(new_item)
    _save_items(items)


def get_connected_accounts() -> list[dict]:
    return [
        {"institution_name": i["institution_name"], "item_id": i["item_id"]}
        for i in _load_items()
    ]


def get_account_balances() -> list[dict]:
    """Live balance fetch for net worth display."""
    client  = _get_api_client()
    results = []

    for item in _load_items():
        try:
            response = client.accounts_balance_get(
                AccountsBalanceGetRequest(access_token=item["access_token"])
            )
            for acct in response.accounts:
                balances = acct.balances
                results.append({
                    "institution_name":   item.get("institution_name", "Unknown"),
                    "account_name":       acct.name or "Account",
                    "account_type":       str(acct.type),
                    "current_balance":    float(balances.current or 0),
                    "available_balance":  float(balances.available) if balances.available is not None else None,
                })
        except Exception:
            continue

    return results


def remove_account(item_id: str) -> None:
    items = [i for i in _load_items() if i.get("item_id") != item_id]
    _save_items(items)


def refresh_all() -> list[str]:
    """
    Call /transactions/refresh for every connected institution.
    This tells Plaid to pull the latest data from the bank right now,
    so the subsequent sync gets the most current transactions.
    Returns a list of error strings (empty on full success).
    """
    client = _get_api_client()
    errors = []

    for item in _load_items():
        try:
            client.transactions_refresh(
                TransactionsRefreshRequest(access_token=item["access_token"])
            )
        except Exception as exc:
            # Investment-only items (e.g. Wealthfront) don't support transactions/refresh
            # — this is expected, not an error worth surfacing
            err_str = str(exc)
            if "PRODUCTS_NOT_SUPPORTED" not in err_str and "NO_ACCOUNTS" not in err_str:
                errors.append(f"{item.get('institution_name', 'Unknown')}: {exc}")

    return errors


def sync_all_transactions(
    existing_df: pd.DataFrame | None = None,
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

    Returns:
      (updated_df, errors, stats)
        updated_df — existing_df with delta applied; new rows have category=None
                     (caller should categorize them)
        errors     — per-institution error strings
        stats      — {"added": N, "modified": M, "removed": R}
    """
    items = _load_items()
    if not items:
        empty = existing_df if existing_df is not None else pd.DataFrame()
        return empty, [], {"added": 0, "modified": 0, "removed": 0}

    client = _get_api_client()
    df     = existing_df.copy() if existing_df is not None and not existing_df.empty else pd.DataFrame()
    errors = []
    total_added = total_modified = total_removed = 0

    for idx, item in enumerate(items):
        access_token = item["access_token"]
        inst_name    = item.get("institution_name", "Plaid")
        cursor       = item.get("cursor")          # None → full pull
        inst_source  = f"Plaid – {inst_name}"

        try:
            added, modified, removed, next_cursor = _fetch_delta(client, access_token, cursor)
        except Exception as exc:
            errors.append(f"{inst_name}: {exc}")
            continue

        # First sync for this item: drop all old rows from this institution
        # so we cleanly replace them — but first save any user annotations
        # (category, notes, tags) keyed by plaid_txn_id so we can restore them.
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
                    # Never reset category for user-edited rows
                    if has_user_edited:
                        edited_mask = mask & df["user_edited"].fillna(False).astype(bool)
                        non_edited  = mask & ~df["user_edited"].fillna(False).astype(bool)
                    else:
                        non_edited = mask
        total_modified += len(modified)

        # Apply additions (category=None — caller categorizes these)
        if added:
            new_rows = [_row_from_txn(t, inst_name, item["item_id"]) for t in added]
            new_df   = pd.DataFrame(new_rows)
            # Restore annotations from before the full resync.
            # user_edited rows are always restored; others only if they had a value.
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
                    # Always restore user-edited rows; restore others only if non-empty
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
        _save_items(items)

    stats = {"added": total_added, "modified": total_modified, "removed": total_removed}
    return df, errors, stats
