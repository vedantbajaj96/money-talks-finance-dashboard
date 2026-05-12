"""routes/feedback_routes.py — /api/feedback endpoints."""
from __future__ import annotations

import datetime
import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user, USERS_FILE
from core.store import DATA_DIR

router = APIRouter()

FEEDBACK_FILE = DATA_DIR / "feedback.json"


def _load_feedback() -> list:
    if FEEDBACK_FILE.exists():
        return json.loads(FEEDBACK_FILE.read_text())
    return []


def _save_feedback(entries: list) -> None:
    FEEDBACK_FILE.write_text(json.dumps(entries, indent=2))


@router.post("/api/feedback")
async def submit_feedback(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message required")
    users        = json.loads(USERS_FILE.read_text()) if USERS_FILE.exists() else {}
    display_name = users.get(current_user, {}).get("display_name") or current_user
    entry = {
        "id":           secrets.token_hex(6),
        "username":     current_user,
        "display_name": display_name,
        "category":     body.get("category") or "general",
        "message":      message,
        "timestamp":    datetime.datetime.now().isoformat(),
    }
    entries = _load_feedback()
    entries.append(entry)
    _save_feedback(entries)
    return {"ok": True}


@router.get("/api/feedback")
def get_feedback(current_user: str = Depends(get_current_user)) -> dict:
    users    = json.loads(USERS_FILE.read_text()) if USERS_FILE.exists() else {}
    is_admin = users.get(current_user, {}).get("is_admin", False)
    entries  = _load_feedback()
    if not is_admin:
        entries = [e for e in entries if e.get("username") == current_user]
    return {"entries": entries, "is_admin": is_admin}
