"""routes/trips_routes.py — /api/trips/* endpoints.

Trips are stored in data/{username}/trips.json.
Transactions are linked to a trip via the existing `tags` column
using the format "trip:{trip_id}". Auto-tagging happens on creation
(all transactions in the date range); users can manually add/remove.
"""
from __future__ import annotations

import datetime
import json
import time
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.store import load_df, save_df, user_dir

router = APIRouter()

_TRIP_PREFIX = "trip:"


def _trips_file(username: str) -> Path:
    return user_dir(username) / "trips.json"


def _load_trips(username: str) -> list[dict]:
    f = _trips_file(username)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text()).get("trips", [])
    except Exception:
        return []


def _save_trips(username: str, trips: list[dict]) -> None:
    _trips_file(username).write_text(json.dumps({"trips": trips}, indent=2))


def _tag(trip_id: str) -> str:
    return f"{_TRIP_PREFIX}{trip_id}"


def _add_tag(existing: str, tag: str) -> str:
    tags = [t.strip() for t in (existing or "").split(",") if t.strip()]
    if tag not in tags:
        tags.append(tag)
    return ", ".join(tags)


def _remove_tag(existing: str, tag: str) -> str:
    return ", ".join(t.strip() for t in (existing or "").split(",") if t.strip() and t.strip() != tag)


def _trip_mask(df: pd.DataFrame, trip_id: str) -> "pd.Series":
    return df["tags"].fillna("").str.contains(_tag(trip_id), regex=False)


@router.get("/api/trips")
def list_trips(current_user: str = Depends(get_current_user)) -> dict:
    trips = _load_trips(current_user)
    df    = load_df(current_user)

    result = []
    for trip in trips:
        total, count = 0, 0
        if df is not None and not df.empty and "tags" in df.columns:
            tagged = df[_trip_mask(df, trip["id"])]
            total  = float(tagged["expense_amount"].clip(lower=0).sum())
            count  = len(tagged)
        result.append({**trip, "total_spent": round(total, 2), "txn_count": count})

    result.sort(key=lambda t: t.get("start_date", ""), reverse=True)
    return {"trips": result}


@router.post("/api/trips")
def create_trip(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    name       = (body.get("name") or "").strip()
    start_date = body.get("start_date", "")
    end_date   = body.get("end_date", "")
    budget     = body.get("budget")

    if not name or not start_date or not end_date:
        raise HTTPException(400, "name, start_date, and end_date are required")
    try:
        d0 = datetime.date.fromisoformat(start_date)
        d1 = datetime.date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    if d1 < d0:
        raise HTTPException(400, "end_date must be on or after start_date")

    trip_id = f"trip_{int(time.time())}"
    trip = {
        "id":         trip_id,
        "name":       name,
        "start_date": start_date,
        "end_date":   end_date,
        "budget":     float(budget) if budget is not None else None,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }

    df = load_df(current_user)
    auto_tagged = 0
    if df is not None and not df.empty:
        tag = _tag(trip_id)
        if "tags" not in df.columns:
            df["tags"] = ""
        date_col = pd.to_datetime(df["date"]).dt.date
        mask     = (date_col >= d0) & (date_col <= d1)
        for idx in df[mask].index:
            df.at[idx, "tags"] = _add_tag(str(df.at[idx, "tags"] or ""), tag)
        auto_tagged = int(mask.sum())
        if auto_tagged:
            save_df(current_user, df)

    trips = _load_trips(current_user)
    trips.append(trip)
    _save_trips(current_user, trips)

    return {"ok": True, "trip": {**trip, "total_spent": 0, "txn_count": auto_tagged}, "auto_tagged": auto_tagged}


@router.get("/api/trips/{trip_id}")
def get_trip(trip_id: str, current_user: str = Depends(get_current_user)) -> dict:
    trips = _load_trips(current_user)
    trip  = next((t for t in trips if t["id"] == trip_id), None)
    if not trip:
        raise HTTPException(404, "Trip not found")

    df = load_df(current_user)
    if df is None or df.empty or "tags" not in df.columns:
        return {**trip, "total_spent": 0, "txn_count": 0,
                "daily_breakdown": [], "category_breakdown": [], "transactions": []}

    tagged   = df[_trip_mask(df, trip_id)].copy()
    expenses = tagged[tagged["expense_amount"] > 0].copy()
    total    = float(expenses["expense_amount"].sum())

    # Daily breakdown
    expenses["_d"] = pd.to_datetime(expenses["date"]).dt.date.astype(str)
    daily = (
        expenses.groupby("_d")["expense_amount"].sum()
        .reset_index()
        .rename(columns={"_d": "date", "expense_amount": "amount"})
        .sort_values("date")
    )
    daily["amount"] = daily["amount"].round(2)

    # Category breakdown
    from core.categories import map_category
    expenses["_cat"] = expenses["category"].apply(lambda c: map_category(str(c or "")))
    cat_totals = (
        expenses.groupby("_cat")["expense_amount"].sum()
        .reset_index()
        .rename(columns={"_cat": "category", "expense_amount": "amount"})
        .sort_values("amount", ascending=False)
    )
    cat_totals["amount"] = cat_totals["amount"].round(2)

    # Transaction list
    txn_list = []
    for _, row in tagged.sort_values("date", ascending=False).iterrows():
        txn_list.append({
            "id":          str(row.get("txn_id", "")),
            "date":        str(row["date"])[:10],
            "description": str(row.get("description", "")),
            "amount":      float(row.get("expense_amount", 0)),
            "category":    map_category(str(row.get("category", ""))),
            "source":      str(row.get("source", "")),
            "notes":       str(row.get("notes", "") or ""),
        })

    return {
        **trip,
        "total_spent":        round(total, 2),
        "txn_count":          len(tagged),
        "daily_breakdown":    daily.to_dict("records"),
        "category_breakdown": cat_totals.to_dict("records"),
        "transactions":       txn_list,
    }


@router.patch("/api/trips/{trip_id}")
def update_trip(trip_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    trips = _load_trips(current_user)
    idx   = next((i for i, t in enumerate(trips) if t["id"] == trip_id), None)
    if idx is None:
        raise HTTPException(404, "Trip not found")
    for field in ("name", "start_date", "end_date", "budget"):
        if field in body:
            trips[idx][field] = body[field]
    _save_trips(current_user, trips)
    return {"ok": True}


@router.delete("/api/trips/{trip_id}")
def delete_trip(trip_id: str, current_user: str = Depends(get_current_user)) -> dict:
    trips = [t for t in _load_trips(current_user) if t["id"] != trip_id]
    _save_trips(current_user, trips)
    df = load_df(current_user)
    if df is not None and not df.empty and "tags" in df.columns:
        tag = _tag(trip_id)
        df["tags"] = df["tags"].fillna("").apply(lambda t: _remove_tag(str(t), tag))
        save_df(current_user, df)
    return {"ok": True}


@router.post("/api/trips/{trip_id}/transactions/{txn_id}")
def add_txn_to_trip(trip_id: str, txn_id: str, current_user: str = Depends(get_current_user)) -> dict:
    if not any(t["id"] == trip_id for t in _load_trips(current_user)):
        raise HTTPException(404, "Trip not found")
    df = load_df(current_user)
    if df is None or "txn_id" not in df.columns:
        raise HTTPException(404, "No data")
    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, "Transaction not found")
    if "tags" not in df.columns:
        df["tags"] = ""
    tag = _tag(trip_id)
    for idx in df[mask].index:
        df.at[idx, "tags"] = _add_tag(str(df.at[idx, "tags"] or ""), tag)
    save_df(current_user, df)
    return {"ok": True}


@router.delete("/api/trips/{trip_id}/transactions/{txn_id}")
def remove_txn_from_trip(trip_id: str, txn_id: str, current_user: str = Depends(get_current_user)) -> dict:
    df = load_df(current_user)
    if df is None or "txn_id" not in df.columns:
        raise HTTPException(404, "No data")
    mask = df["txn_id"] == txn_id
    if not mask.any():
        raise HTTPException(404, "Transaction not found")
    if "tags" in df.columns:
        tag = _tag(trip_id)
        for idx in df[mask].index:
            df.at[idx, "tags"] = _remove_tag(str(df.at[idx, "tags"] or ""), tag)
    save_df(current_user, df)
    return {"ok": True}
