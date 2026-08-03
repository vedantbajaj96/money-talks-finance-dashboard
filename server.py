"""
server.py — FastAPI backend for the MoneyTalks dashboard.

How it fits together
--------------------
The React frontend (frontend/dist/) loads once and calls /api/fin to get all data.
Everything else is mutation: uploading CSVs, editing transactions, syncing Plaid.

Data flow:
  CSV upload  →  parsers.py  →  categorizer/  →  data/{user}/transactions.parquet
  Plaid sync  →  plaid_client.py              →  data/{user}/transactions.parquet
  /api/fin    →  DuckDB reads parquet          →  JSON to frontend

Auth:
  - Users stored in data/users.json (PBKDF2-SHA256 hashes)
  - Sessions persisted in data/sessions.json with 7-day TTL, HTTP-only cookie
  - First user to register becomes admin; admins can create/delete other users
  - All /api/* routes require a valid session cookie (401 otherwise)
  - /api/auth/* and /login are public

Per-user data:
  data/{username}/transactions.parquet  — transactions
  data/{username}/config.json           — API keys (Plaid, Claude, Gemini)
  data/{username}/plaid_items.json      — Plaid linked institutions

Build frontend before running in production:
    cd frontend && npm run build
    python3 server.py
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
import traceback
import warnings
warnings.filterwarnings("ignore", message=".*urllib3.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

import pandas as _pd
_pd.set_option('future.no_silent_downcasting', True)
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging — set up before anything else so startup errors are captured too
# ---------------------------------------------------------------------------

_BASE_DIR_EARLY = Path(__file__).parent
_log_file    = _BASE_DIR_EARLY / "server.log"
_log_handler = logging.handlers.RotatingFileHandler(
    _log_file, maxBytes=1 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s — %(message)s"))

logging.basicConfig(level=logging.INFO, handlers=[_log_handler])
for _name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
    logging.getLogger(_name).addHandler(_log_handler)

logger = logging.getLogger("moneytalks")


def _excepthook(exc_type, exc_value, exc_tb):
    """Catch any unhandled exception that would crash the process."""
    msg = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    logger.critical("UNHANDLED EXCEPTION — process crash\n%s", msg)
    _log_handler.flush()
    sys.__excepthook__(exc_type, exc_value, exc_tb)

sys.excepthook = _excepthook

# ---------------------------------------------------------------------------

from dotenv import load_dotenv
load_dotenv()

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core import limiter
from routes.auth_routes import router as auth_router
from routes.categories_routes import router as categories_router
from routes.chat_routes import router as chat_router
from routes.data_routes import router as data_router
from routes.admin_routes import router as admin_router
from routes.feedback_routes import router as feedback_router
from routes.plaid_routes import router as plaid_router
from routes.upload_routes import router as upload_router
from routes.portfolio_routes import router as portfolio_router
from routes.trips_routes import router as trips_router
from routes.shared_routes import router as shared_router
from routes.verify_routes import router as verify_router

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent
DIST_DIR = BASE_DIR / "frontend" / "dist"   # Vite production build output

# ---------------------------------------------------------------------------
# App + routers
# ---------------------------------------------------------------------------

app = FastAPI(title="MoneyTalks API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


_SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "false").lower() == "true"

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if _SECURE_COOKIES:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' unpkg.com cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' fonts.googleapis.com; "
        "font-src fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self';"
    )
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time as _time
    _t0 = _time.monotonic()
    try:
        response = await call_next(request)
        _ms = (_time.monotonic() - _t0) * 1000
        if _ms > 200:  # only log slow requests (>200ms) to avoid noise
            logger.info("SLOW %s %s → %s in %.0fms", request.method, request.url.path, response.status_code, _ms)
        # Never cache API responses
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as exc:
        _ms = (_time.monotonic() - _t0) * 1000
        logger.error(
            "Unhandled exception on %s %s (%.0fms)\n%s",
            request.method, request.url.path, _ms,
            traceback.format_exc(),
        )
        raise


from core.scheduler import start as _start_scheduler
_start_scheduler()

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(data_router)
app.include_router(categories_router)
app.include_router(upload_router)
app.include_router(plaid_router)
app.include_router(chat_router)
app.include_router(feedback_router)
app.include_router(portfolio_router)
app.include_router(trips_router)
app.include_router(shared_router)
app.include_router(verify_router)

# ---------------------------------------------------------------------------
# Health check (no auth — for Docker health checks / uptime monitoring)

@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


# Serve the React frontend — must be last so /api/* routes take priority.
# ---------------------------------------------------------------------------

@app.get("/{filename:path}")
def serve_frontend(filename: str = "", request: Request = None) -> Response:
    if filename.startswith("api/"):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Not found"}, status_code=404)

    # Root: serve landing page for logged-out visitors
    if not filename:
        from core.auth import SESSION_COOKIE, _sessions
        token = request.cookies.get(SESSION_COOKIE) if request else None
        if not (token and _sessions.get(token)):
            return FileResponse(BASE_DIR / "landing.html", headers={"Cache-Control": "no-store"})

    path = DIST_DIR / filename if filename else DIST_DIR / "index.html"

    # SPA fallback: any unknown path serves index.html so client-side routing works
    if not path.exists() or not path.is_file():
        path = DIST_DIR / "index.html"

    resp = FileResponse(path)
    if path.suffix in (".js", ".css"):
        # Vite outputs content-hashed asset filenames → safe to cache forever
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting MoneyTalks at http://localhost:8502")
    print("Starting MoneyTalks at http://localhost:8502")
    uvicorn.run(app, host="0.0.0.0", port=8502, log_level="info")
