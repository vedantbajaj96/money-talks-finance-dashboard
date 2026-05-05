"""
plaid_client.py — Plaid API wrapper for the Finance Dashboard.

Handles the full Plaid lifecycle:
  1. create_link_token()         — get a token to initialise Plaid Link in the browser
  2. exchange_and_save()         — swap the one-time public_token for a permanent
                                   access_token and persist it to data/plaid_items.json
  3. sync_all_transactions()     — pull transactions from every connected account
                                   and return them as a standard DataFrame
  4. get_connected_accounts()    — list institutions the user has linked
  5. remove_account()            — unlink one institution

Credentials are read from config.json (set via Settings sidebar):
  plaid_client_id, plaid_secret, plaid_environment ("sandbox" | "production")
"""

from __future__ import annotations

import json
import os

import pandas as pd
import plaid
from plaid.api import plaid_api
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from config import load_config

# ---------------------------------------------------------------------------
# Stored items — one entry per connected bank / institution
# ---------------------------------------------------------------------------
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
    """Build a configured PlaidApi instance from the current settings."""
    cfg        = load_config()
    client_id  = cfg.get("plaid_client_id") or os.environ.get("PLAID_CLIENT_ID", "")
    secret     = cfg.get("plaid_secret")     or os.environ.get("PLAID_SECRET", "")
    env_name   = cfg.get("plaid_environment", "sandbox")

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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def is_configured() -> bool:
    """Return True if Plaid credentials have been entered in Settings."""
    cfg = load_config()
    return bool(cfg.get("plaid_client_id")) and bool(cfg.get("plaid_secret"))


def create_link_token() -> str:
    """
    Create a short-lived link_token used to initialise Plaid Link in the browser.
    Raises on failure (caller should surface the error to the user).
    """
    client  = _get_api_client()
    request = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id="local-user"),
        client_name="Finance Dashboard",
        products=[Products("transactions")],
        country_codes=[CountryCode("US")],
        language="en",
        redirect_uri="http://localhost:8502/oauth_callback",
    )
    response = client.link_token_create(request)
    return response["link_token"]


def exchange_and_save(public_token: str, institution_name: str) -> None:
    """
    Exchange a one-time public_token for a permanent access_token and persist it.
    If an item with the same institution_name already exists it is replaced.
    """
    client   = _get_api_client()
    request  = ItemPublicTokenExchangeRequest(public_token=public_token)
    response = client.item_public_token_exchange(request)

    new_item = {
        "access_token":     response["access_token"],
        "item_id":          response["item_id"],
        "institution_name": institution_name,
    }

    items = [i for i in _load_items() if i.get("institution_name") != institution_name]
    items.append(new_item)
    _save_items(items)


def get_connected_accounts() -> list[dict]:
    """Return a list of connected institutions: [{institution_name, item_id}, ...]."""
    return [
        {"institution_name": i["institution_name"], "item_id": i["item_id"]}
        for i in _load_items()
    ]


def remove_account(item_id: str) -> None:
    """Remove a connected account by item_id."""
    items = [i for i in _load_items() if i.get("item_id") != item_id]
    _save_items(items)


def sync_all_transactions(days_back: int = 365) -> pd.DataFrame:
    """
    Pull all transactions from every connected account using /transactions/sync.

    /transactions/sync is cursor-based and returns the full transaction history
    on the first call (no cursor), then only changes on subsequent calls.
    For simplicity we always do a full refresh (no cursor persistence).

    Returns a DataFrame in the standard schema:
      date, description, expense_amount, source, format, source_file

    Plaid amount convention: positive = money out (debit), negative = money in (credit).
    This matches our expense_amount sign convention directly — no flip needed.
    """
    items  = _load_items()
    if not items:
        return pd.DataFrame()

    client   = _get_api_client()
    all_rows = []

    for item in items:
        access_token = item["access_token"]
        inst_name    = item.get("institution_name", "Plaid")
        txns         = _fetch_item_transactions(client, access_token)

        for txn in txns:
            merchant = txn.get("merchant_name") or txn.get("name", "")
            all_rows.append({
                "date":           pd.to_datetime(str(txn["date"])),
                "description":    merchant.strip(),
                "expense_amount": float(txn["amount"]),
                "source":         f"Plaid – {inst_name}",
                "format":         "plaid",
                "source_file":    f"plaid_{item['item_id']}",
            })

    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


def _fetch_item_transactions(client: plaid_api.PlaidApi, access_token: str) -> list:
    """Paginate through /transactions/sync until has_more is False."""
    added    = []
    has_more = True
    cursor   = None

    while has_more:
        kwargs = {"access_token": access_token}
        if cursor:
            kwargs["cursor"] = cursor

        response  = client.transactions_sync(TransactionsSyncRequest(**kwargs))
        added    += list(response["added"])
        has_more  = response["has_more"]
        cursor    = response["next_cursor"]

    return added
