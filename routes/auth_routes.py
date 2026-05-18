"""routes/auth_routes.py — All /api/auth/* endpoints."""
from __future__ import annotations

import datetime
import os
import secrets
from typing import Any

# Set SECURE_COOKIES=true when serving over HTTPS (e.g. public domain with TLS).
# Leave unset for local dev or Tailscale (HTTP) — secure=True breaks HTTP cookies.
_SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "false").lower() == "true"

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core import limiter
from core.auth import (
    SESSION_COOKIE, SESSION_TTL,
    _create_session, _hash_password, _verify_password,
    _load_users, _save_users, _sessions,
    get_current_user, get_admin_user,
)
from core.store import user_dir, migrate_legacy_data

router = APIRouter()


@router.get("/api/auth/status")
def auth_status() -> dict:
    users = _load_users()
    return {"needs_setup": len(users) == 0}


@router.post("/api/auth/setup")
async def auth_setup(body: dict[str, Any], response: Response) -> dict:
    users = _load_users()
    if users:
        raise HTTPException(400, "Setup already completed")
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "Username and password are required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    pw_hash, salt = _hash_password(password)
    users[username] = {
        "hash":         pw_hash,
        "salt":         salt,
        "is_admin":     True,
        "display_name": username,
        "created_at":   datetime.datetime.now().isoformat(),
    }
    _save_users(users)
    dest = user_dir(username)
    dest.mkdir(parents=True, exist_ok=True)
    migrate_legacy_data(dest)

    token = _create_session(username, is_admin=True)
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", secure=_SECURE_COOKIES,
                        max_age=int(SESSION_TTL.total_seconds()))
    return {"ok": True, "username": username, "is_admin": True}


@router.post("/api/auth/login")
@limiter.limit("5/minute")
async def auth_login(request: Request, body: dict[str, Any], response: Response) -> dict:
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    users    = _load_users()
    user     = users.get(username)
    if not user or not _verify_password(password, user["hash"], user["salt"]):
        raise HTTPException(401, "Invalid username or password")

    token = _create_session(username, is_admin=bool(user.get("is_admin")))
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", secure=_SECURE_COOKIES,
                        max_age=int(SESSION_TTL.total_seconds()))
    return {"ok": True, "username": username, "is_admin": bool(user.get("is_admin"))}


@router.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if token and token in _sessions:
        del _sessions[token]
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/api/auth/me")
def auth_me(request: Request, current_user: str = Depends(get_current_user)) -> dict:
    token   = request.cookies.get(SESSION_COOKIE)
    session = _sessions.get(token, {})
    users   = _load_users()
    user    = users.get(current_user, {})
    return {
        "username":     current_user,
        "display_name": user.get("display_name") or current_user,
        "is_admin":     bool(session.get("is_admin")),
    }


@router.patch("/api/auth/me")
async def update_me(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(400, "Display name cannot be empty")
    if len(display_name) > 40:
        raise HTTPException(400, "Display name must be 40 characters or fewer")
    users = _load_users()
    users[current_user]["display_name"] = display_name
    _save_users(users)
    return {"ok": True, "display_name": display_name}


@router.post("/api/auth/register")
async def auth_register(body: dict[str, Any], admin: str = Depends(get_admin_user)) -> dict:
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "Username and password are required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    users = _load_users()
    if username in users:
        raise HTTPException(400, f"User '{username}' already exists")

    pw_hash, salt = _hash_password(password)
    users[username] = {
        "hash":         pw_hash,
        "salt":         salt,
        "is_admin":     bool(body.get("is_admin", False)),
        "display_name": username,
        "created_at":   datetime.datetime.now().isoformat(),
    }
    _save_users(users)
    user_dir(username).mkdir(parents=True, exist_ok=True)
    return {"ok": True, "username": username}


@router.get("/api/auth/users")
def auth_list_users(admin: str = Depends(get_admin_user)) -> dict:
    users = _load_users()
    return {
        "users": [
            {"username": u, "is_admin": bool(v.get("is_admin")), "created_at": v.get("created_at")}
            for u, v in users.items()
        ]
    }


@router.delete("/api/auth/users/{username}")
async def auth_delete_user(username: str, admin: str = Depends(get_admin_user)) -> dict:
    if username == admin:
        raise HTTPException(400, "Cannot delete your own account")
    users = _load_users()
    if username not in users:
        raise HTTPException(404, f"User '{username}' not found")
    del users[username]
    _save_users(users)
    for token, s in list(_sessions.items()):
        if s["username"] == username:
            del _sessions[token]
    return {"ok": True}


@router.post("/api/auth/change-password")
async def auth_change_password(body: dict[str, Any], current_user: str = Depends(get_current_user)) -> dict:
    old_pw = body.get("old_password") or ""
    new_pw = body.get("new_password") or ""
    if not old_pw or not new_pw:
        raise HTTPException(400, "old_password and new_password are required")
    if len(new_pw) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    users = _load_users()
    user  = users[current_user]
    if not _verify_password(old_pw, user["hash"], user["salt"]):
        raise HTTPException(401, "Current password is incorrect")

    pw_hash, salt = _hash_password(new_pw)
    users[current_user]["hash"] = pw_hash
    users[current_user]["salt"] = salt
    _save_users(users)
    return {"ok": True}
