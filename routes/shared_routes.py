"""routes/shared_routes.py — /api/shared/* endpoints.

Shared Spaces: a cross-user expense ledger.
Each space has an owner and participants; expenses are stored in the
owner's shared_expenses.json and indexed by space_id.
"""
from __future__ import annotations

import datetime
import json
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from core.auth import get_current_user, validate_username, USERS_FILE
from core.store import user_dir, load_df

router = APIRouter()

# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

_tokens_lock = threading.Lock()
_DATA_DIR = Path("data")


def _tokens_file() -> Path:
    return _DATA_DIR / "space_tokens.json"


def _load_tokens() -> dict:
    f = _tokens_file()
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text())
    except Exception:
        return {}


def _save_tokens(tokens: dict) -> None:
    with _tokens_lock:
        _tokens_file().write_text(json.dumps(tokens, indent=2))


def _spaces_file(owner: str) -> Path:
    return user_dir(owner) / "shared_spaces.json"


def _expenses_file(owner: str) -> Path:
    return user_dir(owner) / "shared_expenses.json"


def _joined_file(username: str) -> Path:
    return user_dir(username) / "joined_spaces.json"


def _load_spaces(owner: str) -> list[dict]:
    f = _spaces_file(owner)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text()).get("spaces", [])
    except Exception:
        return []


def _save_spaces(owner: str, spaces: list[dict]) -> None:
    _spaces_file(owner).write_text(json.dumps({"spaces": spaces}, indent=2))


def _load_expenses(owner: str) -> list[dict]:
    f = _expenses_file(owner)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text()).get("expenses", [])
    except Exception:
        return []


def _save_expenses(owner: str, expenses: list[dict]) -> None:
    _expenses_file(owner).write_text(json.dumps({"expenses": expenses}, indent=2))


def _load_joined(username: str) -> list[dict]:
    f = _joined_file(username)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text()).get("joined", [])
    except Exception:
        return []


def _save_joined(username: str, joined: list[dict]) -> None:
    _joined_file(username).write_text(json.dumps({"joined": joined}, indent=2))


# ---------------------------------------------------------------------------
# Auth helpers for cross-user access
# ---------------------------------------------------------------------------

def _resolve_space(space_id: str, current_user: str) -> tuple[str, dict]:
    """
    Resolve a space_id to (owner, space_dict).
    Checks the current user's own spaces first, then joined spaces.
    Raises 404 if not found, 403 if not authorized.
    """
    # Check if current user is owner
    own_spaces = _load_spaces(current_user)
    space = next((s for s in own_spaces if s["id"] == space_id), None)
    if space:
        return current_user, space

    # Check if current user is a participant via joined_spaces
    for entry in _load_joined(current_user):
        owner = entry.get("owner", "")
        if entry.get("space_id") == space_id:
            try:
                validate_username(owner)
            except ValueError:
                continue
            spaces = _load_spaces(owner)
            space = next((s for s in spaces if s["id"] == space_id), None)
            if space and current_user in space.get("participants", []):
                return owner, space

    raise HTTPException(404, "Space not found")


def _resolve_expense(e: dict) -> dict | None:
    """
    For ref-type expenses, look up the live transaction in the user's parquet.
    Returns None if the transaction has been deleted.
    Manual expenses are returned unchanged.
    """
    if e.get("type") != "ref":
        return e

    user   = e.get("user", "")
    txn_id = e.get("txn_id", "")
    if not user or not txn_id:
        return None
    try:
        from core.categories import map_category
        df = load_df(user)
        if df is None or "txn_id" not in df.columns:
            return None
        row = df[df["txn_id"] == txn_id]
        if row.empty:
            return None
        r = row.iloc[0]
        return {
            "id":          e["id"],
            "space_id":    e["space_id"],
            "type":        "ref",
            "user":        user,
            "txn_id":      txn_id,
            "description": str(r.get("description", "")),
            "amount":      float(r.get("expense_amount", 0)),
            "date":        str(r.get("date", ""))[:10],
            "category":    map_category(str(r.get("category", ""))),
            "notes":       str(e.get("notes", "") or ""),
            "created_at":  e.get("created_at", ""),
        }
    except Exception:
        return None


def _resolve_space_expenses(space_id: str, raw_expenses: list[dict]) -> list[dict]:
    """Filter to space, resolve refs, drop deleted transactions."""
    resolved = []
    for e in raw_expenses:
        if e.get("space_id") != space_id:
            continue
        r = _resolve_expense(e)
        if r is not None:
            resolved.append(r)
    return resolved


def _space_total(space_id: str, expenses: list[dict]) -> float:
    resolved = _resolve_space_expenses(space_id, expenses)
    return round(sum(e["amount"] for e in resolved), 2)


def _space_last_activity(space_id: str, expenses: list[dict]) -> str | None:
    resolved = _resolve_space_expenses(space_id, expenses)
    dated = [e["date"] for e in resolved if e.get("date")]
    return max(dated) if dated else None


def _display_names(usernames: list[str]) -> dict[str, str]:
    """Return {username: display_name} for the given usernames."""
    try:
        users = json.loads(USERS_FILE.read_text()) if USERS_FILE.exists() else {}
    except Exception:
        users = {}
    return {u: (users.get(u, {}).get("display_name") or u) for u in usernames}


# ---------------------------------------------------------------------------
# Endpoints — IMPORTANT: literal paths (/join, /joined) must come before /{space_id}
# ---------------------------------------------------------------------------

@router.get("/api/shared")
def list_spaces(current_user: str = Depends(get_current_user)) -> dict:
    """Return owned spaces + joined spaces, each with total and last_activity."""
    all_spaces = []

    # Owned spaces
    own_expenses = _load_expenses(current_user)
    for space in _load_spaces(current_user):
        sid = space["id"]
        total = _space_total(sid, own_expenses)
        last  = _space_last_activity(sid, own_expenses)
        all_spaces.append({
            **space,
            "role":          "owner",
            "total_spent":   total,
            "last_activity": last,
        })

    # Joined spaces
    for entry in _load_joined(current_user):
        owner   = entry.get("owner", "")
        space_id = entry.get("space_id", "")
        try:
            validate_username(owner)
        except ValueError:
            continue
        spaces = _load_spaces(owner)
        space  = next((s for s in spaces if s["id"] == space_id), None)
        if not space or current_user not in space.get("participants", []):
            continue  # stale pointer or removed participant
        expenses = _load_expenses(owner)
        total    = _space_total(space_id, expenses)
        last     = _space_last_activity(space_id, expenses)
        owner_dn = _display_names([owner]).get(owner, owner)
        all_spaces.append({
            **space,
            "role":               "participant",
            "owner_display_name": owner_dn,
            "total_spent":        total,
            "last_activity":      last,
        })

    all_spaces.sort(key=lambda s: s.get("last_activity") or s.get("created_at", ""), reverse=True)
    return {"spaces": all_spaces}


@router.post("/api/shared")
async def create_space(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    name       = (body.get("name") or "").strip()
    space_type = (body.get("type") or "event").strip()
    icon       = (body.get("icon") or "📦").strip()
    start_date = body.get("start_date") or None
    end_date   = body.get("end_date") or None
    budget     = body.get("budget")

    if not name:
        raise HTTPException(400, "name is required")
    if space_type not in ("trip", "recurring", "event"):
        raise HTTPException(400, "type must be trip, recurring, or event")
    if start_date:
        try:
            datetime.date.fromisoformat(start_date)
        except ValueError:
            raise HTTPException(400, "start_date must be YYYY-MM-DD")
    if end_date:
        try:
            datetime.date.fromisoformat(end_date)
        except ValueError:
            raise HTTPException(400, "end_date must be YYYY-MM-DD")

    space_id = f"space_{int(time.time())}"
    space = {
        "id":           space_id,
        "name":         name,
        "type":         space_type,
        "icon":         icon,
        "start_date":   start_date,
        "end_date":     end_date,
        "budget":       float(budget) if budget is not None else None,
        "participants": [current_user],
        "created_at":   datetime.datetime.utcnow().isoformat() + "Z",
    }
    spaces = _load_spaces(current_user)
    spaces.append(space)
    _save_spaces(current_user, spaces)
    return {"ok": True, "space": {**space, "role": "owner", "total_spent": 0, "last_activity": None}}


@router.get("/api/shared/join/{token}")
def preview_join(token: str, current_user: str = Depends(get_current_user)) -> dict:
    """Return space preview info without financial details."""
    tokens = _load_tokens()
    entry  = tokens.get(token)
    if not entry:
        raise HTTPException(404, "Invalid or expired share link")
    owner    = entry["owner"]
    space_id = entry["space_id"]
    try:
        validate_username(owner)
    except ValueError:
        raise HTTPException(404, "Invalid share link")
    spaces = _load_spaces(owner)
    space  = next((s for s in spaces if s["id"] == space_id), None)
    if not space:
        raise HTTPException(404, "This trip or space has been deleted")
    return {
        "space_id":         space_id,
        "owner":            owner,
        "name":             space["name"],
        "type":             space["type"],
        "icon":             space["icon"],
        "start_date":       space.get("start_date"),
        "end_date":         space.get("end_date"),
        "participant_count": len(space.get("participants", [])),
        "already_joined":   current_user in space.get("participants", []),
    }


@router.post("/api/shared/join/{token}")
async def join_space(token: str, current_user: str = Depends(get_current_user)) -> dict:
    tokens = _load_tokens()
    entry  = tokens.get(token)
    if not entry:
        raise HTTPException(404, "Invalid or expired share link")
    owner    = entry["owner"]
    space_id = entry["space_id"]
    try:
        validate_username(owner)
    except ValueError:
        raise HTTPException(404, "Invalid share link")

    if current_user == owner:
        return {"ok": True, "already_owner": True}

    spaces = _load_spaces(owner)
    idx    = next((i for i, s in enumerate(spaces) if s["id"] == space_id), None)
    if idx is None:
        raise HTTPException(404, "This space has been deleted")

    space = spaces[idx]
    if current_user in space.get("participants", []):
        return {"ok": True, "already_joined": True, "space": space}

    spaces[idx].setdefault("participants", [owner]).append(current_user)
    _save_spaces(owner, spaces)

    # Add pointer to joiner's joined_spaces.json
    joined = _load_joined(current_user)
    if not any(j["owner"] == owner and j["space_id"] == space_id for j in joined):
        joined.append({"owner": owner, "space_id": space_id})
        _save_joined(current_user, joined)

    return {"ok": True, "space": {"name": space["name"], "owner": owner, "type": space["type"]}}


@router.get("/api/shared/{space_id}")
def get_space(space_id: str, current_user: str = Depends(get_current_user)) -> dict:
    owner, space = _resolve_space(space_id, current_user)
    raw_expenses = _load_expenses(owner)
    expenses     = _resolve_space_expenses(space_id, raw_expenses)

    total = round(sum(e["amount"] for e in expenses), 2)

    # Per-user totals
    per_user: dict[str, dict] = {}
    for e in expenses:
        u = e.get("user", "")
        if u not in per_user:
            per_user[u] = {"user": u, "total": 0.0, "count": 0}
        per_user[u]["total"] = round(per_user[u]["total"] + e["amount"], 2)
        per_user[u]["count"] += 1

    # Enrich per_user with display names
    all_usernames = list(per_user.keys()) + list(space.get("participants", []))
    dn = _display_names(list(set(all_usernames)))
    for entry in per_user.values():
        entry["display_name"] = dn.get(entry["user"], entry["user"])

    # Per-category totals
    per_cat: dict[str, float] = {}
    for e in expenses:
        cat = e.get("category", "other")
        per_cat[cat] = round(per_cat.get(cat, 0.0) + e["amount"], 2)
    category_breakdown = sorted(
        [{"category": k, "amount": v} for k, v in per_cat.items()],
        key=lambda x: x["amount"], reverse=True
    )

    expenses_sorted = sorted(expenses, key=lambda e: e.get("date", ""), reverse=True)
    # Add display_name to each expense for frontend rendering
    for e in expenses_sorted:
        e["display_name"] = dn.get(e.get("user", ""), e.get("user", ""))

    return {
        **space,
        "owner":               owner,
        "owner_display_name":  dn.get(owner, owner),
        "role":                "owner" if current_user == owner else "participant",
        "total_spent":         total,
        "per_user":            list(per_user.values()),
        "category_breakdown":  category_breakdown,
        "expenses":            expenses_sorted,
    }


@router.patch("/api/shared/{space_id}")
async def update_space(space_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    spaces = _load_spaces(current_user)
    idx    = next((i for i, s in enumerate(spaces) if s["id"] == space_id), None)
    if idx is None:
        raise HTTPException(404, "Space not found or you are not the owner")
    for field in ("name", "type", "icon", "start_date", "end_date", "budget", "breakdown_view"):
        if field in body:
            spaces[idx][field] = body[field]
    _save_spaces(current_user, spaces)
    return {"ok": True}


@router.delete("/api/shared/{space_id}")
async def delete_space(space_id: str, current_user: str = Depends(get_current_user)) -> dict:
    spaces = _load_spaces(current_user)
    original_len = len(spaces)
    spaces = [s for s in spaces if s["id"] != space_id]
    if len(spaces) == original_len:
        raise HTTPException(404, "Space not found or you are not the owner")
    _save_spaces(current_user, spaces)

    # Remove all expenses for this space
    expenses = [e for e in _load_expenses(current_user) if e.get("space_id") != space_id]
    _save_expenses(current_user, expenses)

    # Clean up token
    tokens = _load_tokens()
    stale  = [k for k, v in tokens.items() if v.get("space_id") == space_id]
    for k in stale:
        del tokens[k]
    if stale:
        _save_tokens(tokens)

    return {"ok": True}


@router.post("/api/shared/{space_id}/share")
async def share_space(space_id: str, request: Request, current_user: str = Depends(get_current_user)) -> dict:
    spaces = _load_spaces(current_user)
    idx    = next((i for i, s in enumerate(spaces) if s["id"] == space_id), None)
    if idx is None:
        raise HTTPException(404, "Space not found or you are not the owner")

    space = spaces[idx]
    token = space.get("share_token")

    if not token:
        token = secrets.token_hex(16)
        spaces[idx]["share_token"] = token
        _save_spaces(current_user, spaces)
        tokens = _load_tokens()
        tokens[token] = {"owner": current_user, "space_id": space_id}
        _save_tokens(tokens)

    base = str(request.base_url).rstrip("/")
    url  = f"{base}/?join={token}"
    return {"ok": True, "token": token, "url": url}


@router.post("/api/shared/{space_id}/expenses")
async def add_expense(space_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    owner, space = _resolve_space(space_id, current_user)

    txn_id = (body.get("txn_id") or "").strip()

    if txn_id:
        # Ref-type: link to existing transaction — verify it exists for this user
        df = load_df(current_user)
        if df is None or "txn_id" not in df.columns or df[df["txn_id"] == txn_id].empty:
            raise HTTPException(404, "Transaction not found")
        # Check not already added to this space
        raw = _load_expenses(owner)
        if any(e.get("type") == "ref" and e.get("txn_id") == txn_id and e.get("space_id") == space_id for e in raw):
            raise HTTPException(400, "Transaction already added to this space")
        expense = {
            "id":         "exp_" + secrets.token_hex(4),
            "space_id":   space_id,
            "type":       "ref",
            "user":       current_user,
            "txn_id":     txn_id,
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
        }
    else:
        # Manual entry
        description = (body.get("description") or "").strip()
        amount      = body.get("amount")
        date        = body.get("date") or datetime.date.today().isoformat()
        category    = (body.get("category") or "other").strip()

        if not description:
            raise HTTPException(400, "description is required")
        if amount is None:
            raise HTTPException(400, "amount is required")
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise HTTPException(400, "amount must be a number")
        if amount <= 0:
            raise HTTPException(400, "amount must be positive")
        try:
            datetime.date.fromisoformat(date)
        except ValueError:
            raise HTTPException(400, "date must be YYYY-MM-DD")

        expense = {
            "id":          "exp_" + secrets.token_hex(4),
            "space_id":    space_id,
            "type":        "manual",
            "user":        current_user,
            "description": description,
            "amount":      round(amount, 2),
            "date":        date,
            "category":    category,
            "created_at":  datetime.datetime.utcnow().isoformat() + "Z",
        }

    expenses = _load_expenses(owner)
    expenses.append(expense)
    _save_expenses(owner, expenses)
    # Resolve to return live data to the caller
    resolved = _resolve_expense(expense) or expense
    return {"ok": True, "expense": resolved}


@router.post("/api/shared/{space_id}/expenses/batch")
async def add_expenses_batch(space_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Add multiple transactions as ref-type expenses in one request."""
    owner, space = _resolve_space(space_id, current_user)
    txn_ids = body.get("txn_ids") or []
    if not txn_ids or not isinstance(txn_ids, list):
        raise HTTPException(400, "txn_ids must be a non-empty list")
    if len(txn_ids) > 500:
        raise HTTPException(400, "Max 500 transactions per batch")

    df = load_df(current_user)
    if df is None or "txn_id" not in df.columns:
        raise HTTPException(404, "No transaction data found")

    valid_ids = set(df["txn_id"].dropna().astype(str))

    raw = _load_expenses(owner)
    already_added = {e.get("txn_id") for e in raw if e.get("type") == "ref" and e.get("space_id") == space_id}

    now = datetime.datetime.utcnow().isoformat() + "Z"
    added = 0
    skipped = 0
    for txn_id in txn_ids:
        txn_id = str(txn_id)
        if txn_id in already_added:
            skipped += 1
            continue
        if txn_id not in valid_ids:
            skipped += 1
            continue
        raw.append({
            "id":         "exp_" + secrets.token_hex(4),
            "space_id":   space_id,
            "type":       "ref",
            "user":       current_user,
            "txn_id":     txn_id,
            "created_at": now,
        })
        already_added.add(txn_id)
        added += 1

    if added:
        _save_expenses(owner, raw)
    return {"ok": True, "added": added, "skipped": skipped}


@router.patch("/api/shared/{space_id}/expenses/{expense_id}")
async def patch_expense(space_id: str, expense_id: str, body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    """Update mutable fields on a shared expense — currently just `notes`."""
    owner, space = _resolve_space(space_id, current_user)
    expenses = _load_expenses(owner)
    idx = next((i for i, e in enumerate(expenses) if e["id"] == expense_id and e["space_id"] == space_id), None)
    if idx is None:
        raise HTTPException(404, "Expense not found")
    if "notes" in body:
        expenses[idx]["notes"] = (body["notes"] or "").strip()[:500]
    _save_expenses(owner, expenses)
    return {"ok": True}


@router.delete("/api/shared/{space_id}/expenses/{expense_id}")
async def delete_expense(space_id: str, expense_id: str, current_user: str = Depends(get_current_user)) -> dict:
    owner, space = _resolve_space(space_id, current_user)

    expenses = _load_expenses(owner)
    target   = next((e for e in expenses if e["id"] == expense_id and e["space_id"] == space_id), None)
    if not target:
        raise HTTPException(404, "Expense not found")
    if target["user"] != current_user and current_user != owner:
        raise HTTPException(403, "You can only delete your own expenses")

    expenses = [e for e in expenses if e["id"] != expense_id]
    _save_expenses(owner, expenses)
    return {"ok": True}
