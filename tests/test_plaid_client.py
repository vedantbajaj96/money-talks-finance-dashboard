"""
Unit tests for sync_all_transactions in plaid_client.py.

_fetch_delta and _get_api_client are mocked throughout — no real Plaid API
calls are made.  Tests cover:
  - empty item list returns existing_df unchanged
  - first sync (cursor=None) adds rows and saves cursor
  - first sync preserves user annotations (category, notes, tags, user_edited)
  - incremental sync adds new transactions alongside existing ones
  - removals delete the matching row
  - modifications update amount + description only
  - an error on one institution does not prevent others from syncing
"""
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import core.plaid_client as pc  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_items(tmp_path: Path, items: list[dict]) -> str:
    """Write plaid_items.json and return the data_dir string."""
    (tmp_path / "plaid_items.json").write_text(json.dumps({"items": items}))
    return str(tmp_path)


def _txn(txn_id: str, merchant: str = "Test Merchant",
         amount: float = 10.0, date: str = "2024-01-15") -> dict:
    return {
        "transaction_id": txn_id,
        "merchant_name": merchant,
        "amount": amount,
        "date": date,
    }


ITEM = {
    "access_token": "access-sandbox-token",
    "item_id": "item123",
    "institution_name": "Test Bank",
    "cursor": None,
}

ITEM_WITH_CURSOR = {**ITEM, "cursor": "cursor-v1"}


def _plaid_row(txn_id: str, merchant: str = "Old Merchant",
               amount: float = 8.0, institution: str = "Test Bank",
               item_id: str = "item123") -> dict:
    """Build a minimal row that looks like one written by _row_from_txn."""
    return {
        "date":               pd.Timestamp("2024-01-10"),
        "description":        merchant,
        "expense_amount":     amount,
        "source":             f"Plaid – {institution}",
        "format":             "plaid",
        "source_file":        f"plaid_{item_id}",
        "plaid_txn_id":       txn_id,
        "category":           "dining",
        "suggested_category": None,
    }


# ---------------------------------------------------------------------------
# Empty items
# ---------------------------------------------------------------------------

class TestSyncEmptyItems:
    def test_no_items_returns_existing_df(self, tmp_path):
        data_dir = _write_items(tmp_path, [])
        existing = pd.DataFrame([{"date": "2024-01-01", "description": "Manual", "expense_amount": 5.0}])
        df, errors, stats = pc.sync_all_transactions(existing_df=existing, data_dir=data_dir)
        assert len(df) == 1
        assert errors == []
        assert stats == {"added": 0, "modified": 0, "removed": 0}

    def test_no_items_no_existing_returns_empty(self, tmp_path):
        data_dir = _write_items(tmp_path, [])
        df, errors, stats = pc.sync_all_transactions(data_dir=data_dir)
        assert df.empty
        assert stats["added"] == 0


# ---------------------------------------------------------------------------
# First sync (cursor = None)
# ---------------------------------------------------------------------------

class TestFirstSync:
    def test_adds_transactions(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM])
        added = [_txn("t1", "Chipotle", 12.50), _txn("t2", "Amazon", 34.99)]

        with patch.object(pc, "_fetch_delta", return_value=(added, [], [], "cursor-v1")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, errors, stats = pc.sync_all_transactions(data_dir=data_dir)

        assert stats["added"] == 2
        assert errors == []
        assert set(df["plaid_txn_id"]) == {"t1", "t2"}

    def test_saves_cursor_after_sync(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM])

        with patch.object(pc, "_fetch_delta", return_value=([_txn("t1")], [], [], "cursor-v1")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                pc.sync_all_transactions(data_dir=data_dir)

        items = pc._load_items(data_dir)
        assert items[0]["cursor"] == "cursor-v1"

    def test_first_sync_preserves_user_edited_annotation(self, tmp_path):
        """Existing user-edited category/notes/tags survive a full re-sync."""
        data_dir = _write_items(tmp_path, [ITEM])
        existing_df = pd.DataFrame([{
            **_plaid_row("t1", "Chipotle", 12.50),
            "user_edited": True,
            "notes":       "business lunch",
            "tags":        "work",
            "category":    "dining",
        }])

        with patch.object(pc, "_fetch_delta", return_value=([_txn("t1", "Chipotle", 12.50)], [], [], "cursor-v2")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, _, _ = pc.sync_all_transactions(existing_df=existing_df, data_dir=data_dir)

        row = df[df["plaid_txn_id"] == "t1"].iloc[0]
        assert row["notes"] == "business lunch"
        assert row["tags"] == "work"
        assert bool(row["user_edited"]) is True

    def test_first_sync_replaces_existing_institution_rows(self, tmp_path):
        """On cursor=None, old rows for that institution are dropped before re-adding."""
        data_dir = _write_items(tmp_path, [ITEM])
        # existing has t_old which will NOT appear in the fresh pull
        existing_df = pd.DataFrame([_plaid_row("t_old", "Old Shop", 5.0)])

        with patch.object(pc, "_fetch_delta", return_value=([_txn("t_new", "New Shop", 20.0)], [], [], "c1")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, _, _ = pc.sync_all_transactions(existing_df=existing_df, data_dir=data_dir)

        assert "t_old" not in df["plaid_txn_id"].values
        assert "t_new" in df["plaid_txn_id"].values

    def test_stats_counts(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM])
        added = [_txn("t1"), _txn("t2"), _txn("t3")]

        with patch.object(pc, "_fetch_delta", return_value=(added, [], [], "c1")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                _, _, stats = pc.sync_all_transactions(data_dir=data_dir)

        assert stats == {"added": 3, "modified": 0, "removed": 0}


# ---------------------------------------------------------------------------
# Incremental sync (cursor set)
# ---------------------------------------------------------------------------

class TestIncrementalSync:
    def test_adds_new_alongside_existing(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM_WITH_CURSOR])
        existing_df = pd.DataFrame([_plaid_row("t_old", "Old Shop")])

        with patch.object(pc, "_fetch_delta", return_value=([_txn("t_new", "New Shop", 20.0)], [], [], "c2")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, _, stats = pc.sync_all_transactions(existing_df=existing_df, data_dir=data_dir)

        assert stats["added"] == 1
        assert len(df) == 2
        assert "t_new" in df["plaid_txn_id"].values
        assert "t_old" in df["plaid_txn_id"].values

    def test_removal_deletes_row(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM_WITH_CURSOR])
        existing_df = pd.DataFrame([_plaid_row("t_gone", "Gone Shop")])

        with patch.object(pc, "_fetch_delta", return_value=([], [], [{"transaction_id": "t_gone"}], "c2")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, _, stats = pc.sync_all_transactions(existing_df=existing_df, data_dir=data_dir)

        assert stats["removed"] == 1
        assert len(df) == 0

    def test_modification_updates_amount_and_description(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM_WITH_CURSOR])
        existing_df = pd.DataFrame([{
            **_plaid_row("t_mod", "Old Name", 8.0),
            "user_edited": False,
        }])
        modified = [{
            "transaction_id": "t_mod",
            "merchant_name":  "Corrected Name",
            "amount":         9.99,
            "date":           "2024-01-10",
        }]

        with patch.object(pc, "_fetch_delta", return_value=([], modified, [], "c2")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, _, stats = pc.sync_all_transactions(existing_df=existing_df, data_dir=data_dir)

        assert stats["modified"] == 1
        row = df[df["plaid_txn_id"] == "t_mod"].iloc[0]
        assert row["expense_amount"] == pytest.approx(9.99)
        assert row["description"] == "Corrected Name"

    def test_cursor_updated_after_incremental_sync(self, tmp_path):
        data_dir = _write_items(tmp_path, [ITEM_WITH_CURSOR])

        with patch.object(pc, "_fetch_delta", return_value=([], [], [], "cursor-v2")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                pc.sync_all_transactions(data_dir=data_dir)

        items = pc._load_items(data_dir)
        assert items[0]["cursor"] == "cursor-v2"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestSyncErrorHandling:
    def test_error_on_one_institution_does_not_block_others(self, tmp_path):
        items = [
            {**ITEM, "cursor": "c1", "institution_name": "Bad Bank",  "item_id": "bad",  "access_token": "bad-token"},
            {**ITEM, "cursor": "c1", "institution_name": "Good Bank", "item_id": "good", "access_token": "good-token"},
        ]
        data_dir = _write_items(tmp_path, items)

        def _mock_fetch(client, access_token, cursor):
            if access_token == "bad-token":
                raise Exception("Plaid API error")
            return ([_txn("t_good", "Good Shop", 5.0)], [], [], "c2")

        with patch.object(pc, "_fetch_delta", side_effect=_mock_fetch):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                df, errors, stats = pc.sync_all_transactions(data_dir=data_dir)

        assert len(errors) == 1
        assert "Bad Bank" in errors[0]
        assert stats["added"] == 1
        assert "t_good" in df["plaid_txn_id"].values

    def test_error_message_includes_institution_name(self, tmp_path):
        data_dir = _write_items(tmp_path, [{**ITEM, "institution_name": "Broken Bank"}])

        with patch.object(pc, "_fetch_delta", side_effect=Exception("timeout")):
            with patch.object(pc, "_get_api_client", return_value=MagicMock()):
                _, errors, _ = pc.sync_all_transactions(data_dir=data_dir)

        assert any("Broken Bank" in e for e in errors)
