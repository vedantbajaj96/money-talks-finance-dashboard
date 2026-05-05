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

import os

import pandas as pd

_DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DATA_FILE = os.path.join(_DATA_DIR, "transactions.parquet")


def save_transactions(df: pd.DataFrame) -> None:
    """Persist the transactions DataFrame to disk."""
    os.makedirs(_DATA_DIR, exist_ok=True)
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
