"""
Unit tests for routes/trips_routes.py.

Uses FastAPI's TestClient — no running server needed. Auth is bypassed by
overriding the get_current_user dependency. Parquet storage is redirected to
pytest's tmp_path via patching core.store.DATA_DIR.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.store as store_mod
from core.auth import get_current_user
from routes.trips_routes import router

from fastapi import FastAPI

# ---------------------------------------------------------------------------
# App fixture — minimal FastAPI with just the trips router
# ---------------------------------------------------------------------------

_app = FastAPI()
_app.include_router(router)
_app.dependency_overrides[get_current_user] = lambda: "testuser"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "DATA_DIR", tmp_path)
    user_dir = tmp_path / "testuser"
    user_dir.mkdir(parents=True, exist_ok=True)
    return TestClient(_app)


@pytest.fixture
def client_with_txns(tmp_path, monkeypatch):
    """Client pre-loaded with a parquet file that has transactions."""
    monkeypatch.setattr(store_mod, "DATA_DIR", tmp_path)
    user_dir = tmp_path / "testuser"
    user_dir.mkdir(parents=True, exist_ok=True)

    rows = [
        {"txn_id": "a1", "date": "2025-05-10", "description": "Tacos",
         "expense_amount": 25.0, "source": "plaid", "category": "food",
         "notes": "", "tags": ""},
        {"txn_id": "a2", "date": "2025-05-12", "description": "Mezcal Bar",
         "expense_amount": 60.0, "source": "plaid", "category": "dining",
         "notes": "", "tags": ""},
        {"txn_id": "a3", "date": "2025-06-01", "description": "Grocery",
         "expense_amount": 40.0, "source": "plaid", "category": "food",
         "notes": "", "tags": ""},
    ]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df.to_parquet(user_dir / "transactions.parquet", index=False)
    return TestClient(_app)


# ---------------------------------------------------------------------------
# List + Create
# ---------------------------------------------------------------------------

def test_list_empty(client):
    r = client.get("/api/trips")
    assert r.status_code == 200
    assert r.json()["trips"] == []


def test_create_trip_basic(client):
    r = client.post("/api/trips", json={
        "name": "Mexico City",
        "start_date": "2025-05-10",
        "end_date": "2025-05-15",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["trip"]["name"] == "Mexico City"
    assert data["trip"]["start_date"] == "2025-05-10"
    assert data["trip"]["budget"] is None


def test_create_trip_with_budget(client):
    r = client.post("/api/trips", json={
        "name": "Tokyo",
        "start_date": "2025-08-01",
        "end_date": "2025-08-10",
        "budget": 2000,
    })
    assert r.status_code == 200
    assert r.json()["trip"]["budget"] == 2000.0


def test_create_trip_auto_tags_transactions(client_with_txns):
    r = client_with_txns.post("/api/trips", json={
        "name": "Mexico City",
        "start_date": "2025-05-10",
        "end_date": "2025-05-14",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["auto_tagged"] == 2   # a1 and a2 are in range; a3 is not

    # Verify trip now has txn_count from list endpoint
    r2 = client_with_txns.get("/api/trips")
    trip = r2.json()["trips"][0]
    assert trip["txn_count"] == 2
    assert trip["total_spent"] == pytest.approx(85.0)


def test_create_trip_validation(client):
    r = client.post("/api/trips", json={"name": "Bad", "start_date": "2025-05-10"})
    assert r.status_code == 400

    r = client.post("/api/trips", json={
        "name": "Backwards",
        "start_date": "2025-05-15",
        "end_date": "2025-05-10",
    })
    assert r.status_code == 400


def test_list_trips_sorted_newest_first(client):
    client.post("/api/trips", json={"name": "Old", "start_date": "2024-01-01", "end_date": "2024-01-05"})
    client.post("/api/trips", json={"name": "New", "start_date": "2025-05-01", "end_date": "2025-05-05"})

    r = client.get("/api/trips")
    trips = r.json()["trips"]
    assert trips[0]["name"] == "New"
    assert trips[1]["name"] == "Old"


# ---------------------------------------------------------------------------
# Get trip detail
# ---------------------------------------------------------------------------

def test_get_trip(client):
    r = client.post("/api/trips", json={
        "name": "Paris",
        "start_date": "2025-06-01",
        "end_date": "2025-06-07",
    })
    trip_id = r.json()["trip"]["id"]

    r2 = client.get(f"/api/trips/{trip_id}")
    assert r2.status_code == 200
    data = r2.json()
    assert data["name"] == "Paris"
    assert data["daily_breakdown"] == []
    assert data["category_breakdown"] == []
    assert data["transactions"] == []


def test_get_trip_with_transactions(client_with_txns):
    r = client_with_txns.post("/api/trips", json={
        "name": "Mexico City",
        "start_date": "2025-05-10",
        "end_date": "2025-05-14",
    })
    trip_id = r.json()["trip"]["id"]

    r2 = client_with_txns.get(f"/api/trips/{trip_id}")
    assert r2.status_code == 200
    data = r2.json()
    assert data["total_spent"] == pytest.approx(85.0)
    assert len(data["transactions"]) == 2
    assert len(data["daily_breakdown"]) == 2    # two different dates
    assert len(data["category_breakdown"]) >= 1


def test_get_trip_not_found(client):
    r = client.get("/api/trips/nonexistent_id")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_trip(client):
    r = client.post("/api/trips", json={
        "name": "Rome",
        "start_date": "2025-09-01",
        "end_date": "2025-09-07",
    })
    trip_id = r.json()["trip"]["id"]

    r2 = client.patch(f"/api/trips/{trip_id}", json={"name": "Rome (Updated)", "budget": 3000})
    assert r2.status_code == 200
    assert r2.json()["ok"] is True

    r3 = client.get("/api/trips")
    trip = next(t for t in r3.json()["trips"] if t["id"] == trip_id)
    assert trip["name"] == "Rome (Updated)"
    assert trip["budget"] == 3000.0


def test_update_trip_not_found(client):
    r = client.patch("/api/trips/nope", json={"name": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Delete trip
# ---------------------------------------------------------------------------

def test_delete_trip(client_with_txns):
    r = client_with_txns.post("/api/trips", json={
        "name": "Mexico City",
        "start_date": "2025-05-10",
        "end_date": "2025-05-14",
    })
    trip_id = r.json()["trip"]["id"]

    r2 = client_with_txns.delete(f"/api/trips/{trip_id}")
    assert r2.status_code == 200

    r3 = client_with_txns.get("/api/trips")
    assert all(t["id"] != trip_id for t in r3.json()["trips"])


def test_delete_trip_removes_tags(tmp_path, monkeypatch):
    """Deleting a trip should strip its tag from all transactions."""
    monkeypatch.setattr(store_mod, "DATA_DIR", tmp_path)
    user_dir = tmp_path / "testuser"
    user_dir.mkdir(parents=True, exist_ok=True)

    rows = [{"txn_id": "z1", "date": "2025-05-10", "description": "A",
             "expense_amount": 10.0, "source": "plaid", "category": "food",
             "notes": "", "tags": ""}]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df.to_parquet(user_dir / "transactions.parquet", index=False)

    cl = TestClient(_app)
    r = cl.post("/api/trips", json={"name": "T", "start_date": "2025-05-10", "end_date": "2025-05-10"})
    trip_id = r.json()["trip"]["id"]
    assert r.json()["auto_tagged"] == 1

    cl.delete(f"/api/trips/{trip_id}")

    # Tag should be gone
    df2 = store_mod.load_df("testuser")
    assert f"trip:{trip_id}" not in (df2.iloc[0]["tags"] or "")


# ---------------------------------------------------------------------------
# Add / Remove transactions
# ---------------------------------------------------------------------------

def test_add_and_remove_transaction(client_with_txns):
    # Create trip that doesn't auto-tag a3
    r = client_with_txns.post("/api/trips", json={
        "name": "Mexico City",
        "start_date": "2025-05-10",
        "end_date": "2025-05-14",
    })
    trip_id = r.json()["trip"]["id"]

    # a3 is outside date range — add it manually
    r2 = client_with_txns.post(f"/api/trips/{trip_id}/transactions/a3")
    assert r2.status_code == 200
    assert r2.json()["ok"] is True

    detail = client_with_txns.get(f"/api/trips/{trip_id}").json()
    assert any(t["id"] == "a3" for t in detail["transactions"])

    # Remove it
    r3 = client_with_txns.delete(f"/api/trips/{trip_id}/transactions/a3")
    assert r3.status_code == 200

    detail2 = client_with_txns.get(f"/api/trips/{trip_id}").json()
    assert not any(t["id"] == "a3" for t in detail2["transactions"])


def test_add_transaction_trip_not_found(client_with_txns):
    r = client_with_txns.post("/api/trips/fake_trip/transactions/a1")
    assert r.status_code == 404


def test_add_transaction_txn_not_found(client_with_txns):
    r = client_with_txns.post("/api/trips", json={
        "name": "T", "start_date": "2025-05-10", "end_date": "2025-05-10"
    })
    trip_id = r.json()["trip"]["id"]

    r2 = client_with_txns.post(f"/api/trips/{trip_id}/transactions/no_such_txn")
    assert r2.status_code == 404


# ---------------------------------------------------------------------------
# Tag helpers
# ---------------------------------------------------------------------------

def test_multiple_trips_can_tag_same_transaction(tmp_path, monkeypatch):
    """A transaction can belong to more than one trip (tags are comma-separated)."""
    monkeypatch.setattr(store_mod, "DATA_DIR", tmp_path)
    user_dir = tmp_path / "testuser"
    user_dir.mkdir(parents=True, exist_ok=True)

    rows = [{"txn_id": "m1", "date": "2025-05-10", "description": "X",
             "expense_amount": 10.0, "source": "plaid", "category": "food",
             "notes": "", "tags": ""}]
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df.to_parquet(user_dir / "transactions.parquet", index=False)

    cl = TestClient(_app)
    t1 = cl.post("/api/trips", json={"name": "A", "start_date": "2025-05-10", "end_date": "2025-05-10"}).json()["trip"]["id"]
    t2 = cl.post("/api/trips", json={"name": "B", "start_date": "2025-05-20", "end_date": "2025-05-20"}).json()["trip"]["id"]
    cl.post(f"/api/trips/{t2}/transactions/m1")

    df2 = store_mod.load_df("testuser")
    tags = df2.iloc[0]["tags"]
    assert f"trip:{t1}" in tags
    assert f"trip:{t2}" in tags
