"""
Integration tests for build_fin_data (core/fin_data.py).

Creates real parquet files under pytest's tmp_path so DuckDB can read them.
Plaid balance calls are short-circuited by not providing plaid credentials in
config (is_configured returns False → balance fetch is skipped).
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.store as store_mod
from core.fin_data import build_fin_data


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_parquet(tmp_path: Path, rows: list[dict], username: str = "testuser") -> Path:
    user_dir = tmp_path / username
    user_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df.to_parquet(user_dir / "transactions.parquet", index=False)
    return tmp_path


def _run(tmp_path: Path, username: str = "testuser") -> dict:
    """Call build_fin_data with DATA_DIR patched to tmp_path."""
    with patch.object(store_mod, "DATA_DIR", tmp_path):
        return build_fin_data(username)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

SAMPLE_ROWS = [
    {
        "date": "2024-01-15",
        "description": "Chipotle",
        "expense_amount": 12.50,
        "category": "Dining & Drinks",
        "source": "Chase Visa",
        "txn_id": "txn001",
        "transaction_type": "expense",
        "notes": "",
        "tags": "",
    },
    {
        "date": "2024-01-10",
        "description": "Direct Deposit",
        "expense_amount": -3000.0,
        "category": "Paycheck & Salary",
        "source": "Chase Checking",
        "txn_id": "txn002",
        "transaction_type": "income",
        "notes": "",
        "tags": "",
    },
    {
        "date": "2024-01-05",
        "description": "Automatic Payment - Chase",
        "expense_amount": 500.0,
        "category": "Other",
        "source": "Chase Visa",
        "txn_id": "txn003",
        "transaction_type": "expense",
        "notes": "",
        "tags": "",
    },
]


# ---------------------------------------------------------------------------
# Structure tests
# ---------------------------------------------------------------------------

class TestBuildFinDataStructure:
    def test_returns_all_required_keys(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        result = _run(tmp_path)
        for key in ("hasData", "ACCOUNTS", "CATEGORIES", "MONTHS", "TRANSACTIONS",
                    "RECURRING", "NET_WORTH_HISTORY"):
            assert key in result, f"Missing top-level key: {key}"

    def test_has_data_true(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        assert _run(tmp_path)["hasData"] is True

    def test_months_count_and_format(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        months = _run(tmp_path)["MONTHS"]
        assert len(months) == 1
        assert months[0]["key"] == "2024-01"
        assert months[0]["label"] == "Jan 2024"
        assert months[0]["short"] == "Jan"

    def test_multiple_months(self, tmp_path):
        rows = SAMPLE_ROWS + [{
            "date": "2024-02-01", "description": "Netflix", "expense_amount": 15.0,
            "category": "Connectivity", "source": "Chase Visa", "txn_id": "txn004",
            "transaction_type": "expense", "notes": "", "tags": "",
        }]
        _write_parquet(tmp_path, rows)
        months = _run(tmp_path)["MONTHS"]
        assert len(months) == 2
        keys = [m["key"] for m in months]
        assert "2024-01" in keys
        assert "2024-02" in keys

    def test_transaction_count(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        assert len(_run(tmp_path)["TRANSACTIONS"]) == 3

    def test_accounts_present(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        accounts    = _run(tmp_path)["ACCOUNTS"]
        account_ids = [a["id"] for a in accounts]
        assert "Chase Visa" in account_ids
        assert "Chase Checking" in account_ids

    def test_categories_list_not_empty(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        cats = _run(tmp_path)["CATEGORIES"]
        assert len(cats) > 0
        for c in cats:
            assert "id" in c
            assert "name" in c
            assert "color" in c


# ---------------------------------------------------------------------------
# Category resolution in transactions
# ---------------------------------------------------------------------------

class TestBuildFinDataCategoryResolution:
    def _txns_by_merchant(self, tmp_path) -> dict:
        _write_parquet(tmp_path, SAMPLE_ROWS)
        txns = _run(tmp_path)["TRANSACTIONS"]
        return {t["merchant"]: t for t in txns}

    def test_dining_category(self, tmp_path):
        assert self._txns_by_merchant(tmp_path)["Chipotle"]["category"] == "dining"

    def test_autopayment_becomes_transfer(self, tmp_path):
        assert self._txns_by_merchant(tmp_path)["Automatic Payment - Chase"]["category"] == "transfer"

    def test_income_category(self, tmp_path):
        assert self._txns_by_merchant(tmp_path)["Direct Deposit"]["category"] == "income"

    def test_amount_negation(self, tmp_path):
        txns = self._txns_by_merchant(tmp_path)
        assert txns["Chipotle"]["amount"] == pytest.approx(-12.50)

    def test_each_txn_has_required_fields(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        for t in _run(tmp_path)["TRANSACTIONS"]:
            for field in ("id", "date", "merchant", "category", "amount", "account", "confidence"):
                assert field in t, f"Transaction missing field '{field}': {t}"


# ---------------------------------------------------------------------------
# Confidence scoring
# ---------------------------------------------------------------------------

class TestBuildFinDataConfidence:
    def test_uncategorized_is_low(self, tmp_path):
        rows = [{
            "date": "2024-01-01", "description": "Mystery Shop", "expense_amount": 5.0,
            "category": "other", "source": "Bank", "txn_id": "txn_low",
            "transaction_type": "expense", "notes": "", "tags": "",
        }]
        _write_parquet(tmp_path, rows)
        txns = _run(tmp_path)["TRANSACTIONS"]
        assert txns[0]["confidence"] == "low"

    def test_known_category_is_medium(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        txns = {t["merchant"]: t for t in _run(tmp_path)["TRANSACTIONS"]}
        assert txns["Chipotle"]["confidence"] == "medium"

    def test_approved_txn_is_high(self, tmp_path):
        rows = [{
            "date": "2024-01-01", "description": "Approved Shop", "expense_amount": 10.0,
            "category": "shopping", "source": "Bank", "txn_id": "txn_approved",
            "transaction_type": "expense", "notes": "", "tags": "",
            "approved": True, "user_edited": False,
        }]
        _write_parquet(tmp_path, rows)
        txns = _run(tmp_path)["TRANSACTIONS"]
        assert txns[0]["confidence"] == "high"

    def test_user_edited_txn_is_high(self, tmp_path):
        rows = [{
            "date": "2024-01-01", "description": "Edited Shop", "expense_amount": 10.0,
            "category": "shopping", "source": "Bank", "txn_id": "txn_edited",
            "transaction_type": "expense", "notes": "", "tags": "",
            "approved": False, "user_edited": True,
        }]
        _write_parquet(tmp_path, rows)
        txns = _run(tmp_path)["TRANSACTIONS"]
        assert txns[0]["confidence"] == "high"

    def test_confidence_valid_values(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        for t in _run(tmp_path)["TRANSACTIONS"]:
            assert t["confidence"] in ("high", "medium", "low"), (
                f"Unexpected confidence '{t['confidence']}' on {t['merchant']}"
            )


# ---------------------------------------------------------------------------
# Split expansion
# ---------------------------------------------------------------------------

class TestBuildFinDataSplits:
    def _run_with_splits(self, tmp_path, splits: dict, username: str = "testuser") -> dict:
        _write_parquet(tmp_path, SAMPLE_ROWS, username)
        splits_path = tmp_path / username / "splits.json"
        splits_path.write_text(json.dumps(splits))
        return _run(tmp_path, username)

    def test_split_replaces_parent_with_multiple_rows(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [
                {"category": "dining",    "amount": 7.50, "notes": "meal"},
                {"category": "groceries", "amount": 5.00, "notes": "tip"},
            ]
        })
        split_rows = [t for t in result["TRANSACTIONS"] if t.get("is_split")]
        assert len(split_rows) == 2

    def test_split_synthetic_ids(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [
                {"category": "dining",    "amount": 7.50, "notes": ""},
                {"category": "groceries", "amount": 5.00, "notes": ""},
            ]
        })
        ids = {t["id"] for t in result["TRANSACTIONS"] if t.get("is_split")}
        assert "txn001_s0" in ids
        assert "txn001_s1" in ids

    def test_parent_id_removed_from_output(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [{"category": "dining", "amount": 12.50, "notes": ""}]
        })
        ids = [t["id"] for t in result["TRANSACTIONS"]]
        assert "txn001" not in ids

    def test_unsplit_transactions_unchanged(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [{"category": "dining", "amount": 12.50, "notes": ""}]
        })
        ids = {t["id"] for t in result["TRANSACTIONS"]}
        assert "txn002" in ids
        assert "txn003" in ids

    def test_split_category_applied(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [
                {"category": "health",   "amount": 6.00, "notes": ""},
                {"category": "shopping", "amount": 6.50, "notes": ""},
            ]
        })
        split_rows = {t["id"]: t for t in result["TRANSACTIONS"] if t.get("is_split")}
        assert split_rows["txn001_s0"]["category"] == "health"
        assert split_rows["txn001_s1"]["category"] == "shopping"

    def test_no_splits_file_leaves_transactions_unchanged(self, tmp_path):
        _write_parquet(tmp_path, SAMPLE_ROWS)
        result = _run(tmp_path)
        assert len(result["TRANSACTIONS"]) == 3
        ids = {t["id"] for t in result["TRANSACTIONS"]}
        assert "txn001" in ids
        assert "txn002" in ids
        assert "txn003" in ids

    def test_parent_id_field_set_on_split_rows(self, tmp_path):
        result = self._run_with_splits(tmp_path, {
            "txn001": [{"category": "dining", "amount": 12.50, "notes": ""}]
        })
        split = next(t for t in result["TRANSACTIONS"] if t.get("is_split"))
        assert split["parent_id"] == "txn001"
