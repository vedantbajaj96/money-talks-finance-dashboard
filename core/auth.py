"""
core/auth.py — Authentication: password hashing, file-backed session store,
               and FastAPI dependency functions.

_SessionStore persists sessions to data/sessions.json so logins survive
server restarts.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import re
import secrets
import threading
from pathlib import Path

from fastapi import HTTPException, Request

from core.store import DATA_DIR, BASE_DIR

USERS_FILE     = DATA_DIR / "users.json"
SESSIONS_FILE  = DATA_DIR / "sessions.json"
SESSION_COOKIE = "mt_session"
SESSION_TTL    = datetime.timedelta(days=7)


# ---------------------------------------------------------------------------
# File-backed session store
# ---------------------------------------------------------------------------

class _SessionStore:
    """Persist sessions to data/sessions.json so logins survive restarts.

    The ``expires`` field is stored as ISO-format string and parsed back to
    datetime on load.  The store is lazily loaded on first access.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._data: dict[str, dict] = {}
        self._loaded = False
        self._lock = threading.Lock()

    def _load(self) -> None:
        if self._loaded:
            return
        if self._path.exists():
            try:
                raw: dict = json.loads(self._path.read_text())
                for s in raw.values():
                    if "expires" in s and isinstance(s["expires"], str):
                        s["expires"] = datetime.datetime.fromisoformat(s["expires"])
                self._data = raw
            except Exception:
                self._data = {}
        self._loaded = True

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        serializable: dict = {}
        for token, s in self._data.items():
            entry = dict(s)
            if isinstance(entry.get("expires"), datetime.datetime):
                entry["expires"] = entry["expires"].isoformat()
            serializable[token] = entry
        self._path.write_text(json.dumps(serializable, indent=2))

    def get(self, token: str, default=None):
        with self._lock:
            self._load()
            return self._data.get(token, default)

    def __setitem__(self, token: str, session: dict) -> None:
        with self._lock:
            self._load()
            self._data[token] = session
            self._save()

    def __delitem__(self, token: str) -> None:
        with self._lock:
            self._load()
            self._data.pop(token, None)
            self._save()

    def __contains__(self, token: object) -> bool:
        with self._lock:
            self._load()
            return token in self._data

    def items(self):
        with self._lock:
            self._load()
            return list(self._data.items())


_sessions = _SessionStore(SESSIONS_FILE)


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Return (hex_hash, salt). Generates a new salt when none is given."""
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return dk.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    h, _ = _hash_password(password, salt)
    return secrets.compare_digest(h, stored_hash)


# ---------------------------------------------------------------------------
# User store helpers
# ---------------------------------------------------------------------------

_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_-]{1,32}$')

def validate_username(username: str) -> None:
    """Raise ValueError if username contains path-traversal or disallowed chars."""
    if not _USERNAME_RE.match(username):
        raise ValueError("Username must be 1–32 characters: letters, digits, _ or -")

_users_lock = threading.Lock()

def _load_users() -> dict:
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_users(users: dict) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2))


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

def _create_session(username: str, is_admin: bool) -> str:
    """Create a new session token and persist it to the session store."""
    token = secrets.token_hex(32)
    _sessions[token] = {
        "username": username,
        "is_admin": is_admin,
        "expires":  datetime.datetime.utcnow() + SESSION_TTL,
    }
    return token


# ---------------------------------------------------------------------------
# FastAPI dependency functions
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> str:
    """FastAPI dependency — returns username or raises 401."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _sessions.get(token)
    if not session:
        raise HTTPException(401, "Invalid session")
    if datetime.datetime.utcnow() > session["expires"]:
        del _sessions[token]
        raise HTTPException(401, "Session expired")
    return session["username"]


def get_admin_user(request: Request) -> str:
    """FastAPI dependency — returns username or raises 403 if not admin."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _sessions.get(token)
    if not session or datetime.datetime.utcnow() > session["expires"]:
        raise HTTPException(401, "Invalid or expired session")
    if not session.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return session["username"]
