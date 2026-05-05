"""
storage.py — Local persistence for transaction data.

Saves the transactions DataFrame to a Parquet file in the data/ directory so
that the app survives page refreshes without requiring a re-upload.

Public API:
  save_transactions(df)  — write current DataFrame to disk
  load_transactions()    — read it back (returns None if nothing saved yet)
  clear_transactions()   — delete the saved file (called on Start Over)
"""

from __future__ import annotations

import hashlib
import os

import pandas as pd

_DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DATA_FILE = os.path.join(_DATA_DIR, "transactions.parquet")


def ensure_annotation_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ensure notes, tags, and txn_id columns exist.
    txn_id is a stable hash of (date, description, expense_amount) so annotations
    survive re-syncs and merges.
    """
    df = df.copy()
    if "notes" not in df.columns:
        df["notes"] = ""
    if "tags" not in df.columns:
        df["tags"] = ""
    if "txn_id" not in df.columns:
        df["txn_id"] = df.apply(
            lambda r: hashlib.md5(
                f"{r['date']}|{r['description']}|{r['expense_amount']}".encode()
            ).hexdigest()[:12],
            axis=1,
        )
    return df


def save_transactions(df: pd.DataFrame) -> None:
    """Persist the transactions DataFrame to disk."""
    os.makedirs(_DATA_DIR, exist_ok=True)
    df = ensure_annotation_columns(df)
    df.to_parquet(_DATA_FILE, index=False)


def load_transactions() -> pd.DataFrame | None:
    """
    Load the saved transactions DataFrame.
    Returns None if no data has been saved yet or the file is unreadable.
    """
    if not os.path.exists(_DATA_FILE):
        return None
    try:
        df = pd.read_parquet(_DATA_FILE)
        return df if not df.empty else None
    except Exception:
        return None


def clear_transactions() -> None:
    """Delete saved data (called when the user clicks Start Over)."""
    if os.path.exists(_DATA_FILE):
        os.remove(_DATA_FILE)
