"""
server.py — FastAPI backend for the MoneyTalks dashboard.

How it fits together
--------------------
The React frontend (moneytalks/) loads once and calls /api/fin to get all data.
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

Run:
    python3 server.py
"""

from __future__ import annotations

import datetime
import logging
import logging.handlers
import subprocess
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

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from core.auth import SESSION_COOKIE, _sessions
from routes.auth_routes import router as auth_router
from routes.categories_routes import router as categories_router
from routes.chat_routes import router as chat_router
from routes.data_routes import router as data_router
from routes.feedback_routes import router as feedback_router
from routes.plaid_routes import router as plaid_router
from routes.upload_routes import router as upload_router

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent
LL_DIR   = BASE_DIR / "moneytalks"
JSX_FILES = ["tweaks-panel.jsx", "charts.jsx", "tabs.jsx", "app.jsx"]

# ---------------------------------------------------------------------------
# JSX pre-compilation
# ---------------------------------------------------------------------------

def _compile_jsx(jsx_path: Path) -> None:
    js_path = jsx_path.with_suffix(".js.compiled")
    script = f"""
const babel = require('@babel/core'), fs = require('fs');
const code = babel.transformSync(fs.readFileSync({repr(str(jsx_path))}, 'utf8'), {{presets: ['@babel/preset-react']}}).code;
fs.writeFileSync({repr(str(js_path))}, code);
"""
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, cwd=str(LL_DIR))
    if result.returncode != 0:
        raise RuntimeError(result.stderr[:400])


def _ensure_compiled(name: str) -> Path:
    jsx_path = LL_DIR / name
    js_path  = LL_DIR / name.replace(".jsx", ".js.compiled")
    if not js_path.exists() or jsx_path.stat().st_mtime > js_path.stat().st_mtime:
        print(f"  Compiling {name}...", flush=True)
        _compile_jsx(jsx_path)
    return js_path


print("Compiling JSX...", flush=True)
for _f in JSX_FILES:
    try:
        _ensure_compiled(_f)
    except Exception as _e:
        print(f"  WARNING {_f}: {_e}", flush=True)
print("JSX ready.", flush=True)

# ---------------------------------------------------------------------------
# App + routers
# ---------------------------------------------------------------------------

app = FastAPI(title="MoneyTalks API")


@app.middleware("http")
async def log_exceptions(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        logger.error(
            "Unhandled exception on %s %s\n%s",
            request.method, request.url.path,
            traceback.format_exc(),
        )
        raise


app.include_router(auth_router)
app.include_router(data_router)
app.include_router(categories_router)
app.include_router(upload_router)
app.include_router(plaid_router)
app.include_router(chat_router)
app.include_router(feedback_router)

# ---------------------------------------------------------------------------
# Serve the React frontend — must be last so /api/* routes take priority.
# ---------------------------------------------------------------------------

@app.get("/login")
def serve_login() -> FileResponse:
    return FileResponse(LL_DIR / "login.html")


@app.get("/{filename:path}")
def serve_frontend(filename: str = "", request: Request = None) -> Response:
    path = LL_DIR / filename if filename else LL_DIR / "index.html"

    is_asset = path.suffix in (".js", ".jsx", ".css", ".png", ".ico", ".svg", ".woff", ".woff2")
    if not is_asset:
        token   = request.cookies.get(SESSION_COOKIE) if request else None
        session = _sessions.get(token) if token else None
        if not session or datetime.datetime.utcnow() > session.get("expires", datetime.datetime.min):
            return RedirectResponse("/login")

    if path.suffix == ".jsx" and path.name in JSX_FILES:
        try:
            compiled = _ensure_compiled(path.name)
            resp = FileResponse(compiled, media_type="application/javascript")
            resp.headers["Cache-Control"] = "no-store"
            return resp
        except Exception as e:
            print(f"Compile error for {path.name}: {e}")

    if not path.exists() or not path.is_file():
        path = LL_DIR / "index.html"

    resp = FileResponse(path)
    if path.suffix in (".js", ".jsx", ".css"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting MoneyTalks at http://localhost:8502")
    print("Starting MoneyTalks at http://localhost:8502")
    uvicorn.run(app, host="0.0.0.0", port=8502, log_level="info")
