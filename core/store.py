"""
core/store.py — Per-user file system layout, load/save helpers, DuckDB connection cache.

All path construction is centralised here. Other modules import helpers from
this module rather than constructing paths themselves.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import duckdb
import pandas as pd

BASE_DIR = Path(__file__).parent.parent   # finance_dashboard/
DATA_DIR = BASE_DIR / "data"


# ---------------------------------------------------------------------------
# Per-user path helpers
# ---------------------------------------------------------------------------

def user_dir(username: str) -> Path:
    return DATA_DIR / username

def data_file(username: str) -> Path:
    return user_dir(username) / "transactions.parquet"

def config_file(username: str) -> Path:
    return user_dir(username) / "config.json"

def splits_file(username: str) -> Path:
    return user_dir(username) / "splits.json"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _admin_username() -> str | None:
    """Return the first admin username, used for shared key fallback."""
    users_file = DATA_DIR / "users.json"
    if users_file.exists():
        try:
            users = json.loads(users_file.read_text())
            for u, v in users.items():
                if v.get("is_admin"):
                    return u
        except Exception:
            pass
    return None


def load_config(username: str) -> dict:
    f = config_file(username)
    cfg: dict = {}
    if f.exists():
        try:
            cfg = json.loads(f.read_text())
        except Exception:
            pass

    # For non-admin users: inherit API keys from admin if not set locally.
    admin = _admin_username()
    if admin and admin != username:
        admin_cfg = {}
        af = config_file(admin)
        if af.exists():
            try:
                admin_cfg = json.loads(af.read_text())
            except Exception:
                pass
        for key in ("anthropic_api_key", "gemini_api_key", "preferred_provider"):
            if not cfg.get(key) and admin_cfg.get(key):
                cfg[key] = admin_cfg[key]

    return cfg

def save_config(username: str, cfg: dict) -> None:
    f = config_file(username)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cfg, indent=2))


# ---------------------------------------------------------------------------
# Splits
# ---------------------------------------------------------------------------

def load_splits(username: str) -> dict:
    f = splits_file(username)
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            return {}
    return {}

def save_splits(username: str, data: dict) -> None:
    splits_file(username).write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Pandas helpers
# ---------------------------------------------------------------------------

def load_df(username: str) -> pd.DataFrame | None:
    f = data_file(username)
    if not f.exists():
        return None
    try:
        df = pd.read_parquet(f)
        return df if not df.empty else None
    except Exception:
        return None

def save_df(username: str, df: pd.DataFrame) -> None:
    f = data_file(username)
    f.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(f, index=False)


# ---------------------------------------------------------------------------
# DuckDB connection cache
# ---------------------------------------------------------------------------

_duckdb_cache: dict[str, dict] = {}

def get_conn(username: str) -> duckdb.DuckDBPyConnection:
    """Return a cached DuckDB connection; refreshes the view when parquet changes."""
    parquet_path = data_file(username)
    path_str     = str(parquet_path).replace("'", "''")
    try:
        mtime = parquet_path.stat().st_mtime
    except FileNotFoundError:
        mtime = 0.0

    cached = _duckdb_cache.get(username)
    if cached and cached["mtime"] == mtime:
        return cached["conn"]

    c = duckdb.connect()
    c.execute(f"CREATE VIEW txns AS SELECT * FROM read_parquet('{path_str}')")
    _duckdb_cache[username] = {"conn": c, "mtime": mtime}
    return c


# ---------------------------------------------------------------------------
# Legacy data migration  (pre-auth single-user layout → per-user directories)
# ---------------------------------------------------------------------------

def migrate_legacy_data(dest: Path) -> None:
    """Move pre-auth data files into the first user's directory if they exist."""
    legacy_txn   = DATA_DIR / "transactions.parquet"
    legacy_cfg   = BASE_DIR / "config.json"
    legacy_plaid = DATA_DIR / "plaid_items.json"

    if legacy_txn.exists() and not (dest / "transactions.parquet").exists():
        shutil.copy2(legacy_txn, dest / "transactions.parquet")
    if legacy_cfg.exists() and not (dest / "config.json").exists():
        shutil.copy2(legacy_cfg, dest / "config.json")
    if legacy_plaid.exists() and not (dest / "plaid_items.json").exists():
        shutil.copy2(legacy_plaid, dest / "plaid_items.json")
