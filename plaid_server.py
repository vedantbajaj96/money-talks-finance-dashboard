"""
plaid_server.py — Lightweight FastAPI server that handles Plaid Link.

Run alongside Streamlit (port 8501) on port 8502.
The simplest way to start both is:  python3 run.py

Routes:
  GET  /connect          Serves the Plaid Link HTML page
  GET  /oauth_callback   OAuth redirect landing page (for banks like Chase)
  POST /api/link_token   Returns a fresh link_token for Plaid Link
  POST /api/exchange     Exchanges public_token → access_token, saves it,
                         then signals Streamlit to refresh

The HTML page auto-opens Plaid Link. On success it POSTs the public_token
here, which exchanges it and redirects the user back to Streamlit.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from plaid_client import create_link_token, exchange_and_save

app = FastAPI(title="Finance Dashboard — Plaid Gateway")

# ---------------------------------------------------------------------------
# HTML served to the browser for the Plaid Link flow
# ---------------------------------------------------------------------------

_CONNECT_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Bank — Finance Dashboard</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 100vh; margin: 0;
      background: #f8f9fa; color: #333;
    }
    h1   { font-size: 1.4rem; margin-bottom: 0.5rem; }
    p    { color: #666; margin-bottom: 2rem; font-size: 0.95rem; }
    #btn {
      background: #1d6ef9; color: white; border: none; border-radius: 6px;
      padding: 12px 28px; font-size: 1rem; cursor: pointer;
    }
    #btn:disabled { background: #aaa; cursor: default; }
    #status { margin-top: 1.5rem; color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>💰 Finance Dashboard</h1>
  <p>Connect your bank account to automatically import transactions.</p>
  <button id="btn" onclick="openPlaid()" disabled>Loading…</button>
  <div id="status"></div>

  <script>
  let handler;

  async function init() {
    const res   = await fetch('/api/link_token', { method: 'POST' });
    const data  = await res.json();

    if (data.error) {
      document.getElementById('status').textContent = 'Error: ' + data.error;
      return;
    }

    handler = Plaid.create({
      token: data.link_token,
      onSuccess: async (publicToken, metadata) => {
        const btn = document.getElementById('btn');
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        document.getElementById('status').textContent = 'Saving connection…';

        const res2 = await fetch('/api/exchange', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            public_token:     publicToken,
            institution_name: metadata.institution ? metadata.institution.name : 'Unknown',
          }),
        });
        const result = await res2.json();

        if (result.ok) {
          document.getElementById('status').textContent = '✅ Connected! Returning to dashboard…';
          setTimeout(() => { window.location.href = 'http://localhost:8501'; }, 1200);
        } else {
          document.getElementById('status').textContent = 'Error: ' + (result.error || 'Unknown error');
          btn.disabled = false;
          btn.textContent = 'Try Again';
        }
      },
      onExit: (err) => {
        if (err) {
          document.getElementById('status').textContent = err.display_message || 'Connection cancelled.';
        }
        const btn = document.getElementById('btn');
        btn.disabled = false;
        btn.textContent = 'Connect Bank Account';
      },
    });

    const btn = document.getElementById('btn');
    btn.disabled = false;
    btn.textContent = 'Connect Bank Account';
  }

  function openPlaid() {
    if (handler) handler.open();
  }

  init();
  </script>
</body>
</html>"""


_OAUTH_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connecting… — Finance Dashboard</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
    p    { color: #555; font-size: 1rem; }
  </style>
</head>
<body>
  <p id="status">Finishing bank connection…</p>
  <script>
  // Re-initialise Plaid Link in OAuth return mode using the stored link_token.
  const stored = sessionStorage.getItem('plaid_link_token');
  if (stored) {
    const handler = Plaid.create({
      token: stored,
      receivedRedirectUri: window.location.href,
      onSuccess: async (publicToken, metadata) => {
        document.getElementById('status').textContent = 'Saving…';
        await fetch('/api/exchange', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            public_token:     publicToken,
            institution_name: metadata.institution ? metadata.institution.name : 'Unknown',
          }),
        });
        window.location.href = 'http://localhost:8501';
      },
    });
    handler.open();
  } else {
    document.getElementById('status').textContent =
      'Session expired. Please return to the dashboard and try again.';
  }
  </script>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/connect", response_class=HTMLResponse)
async def connect_page():
    """Serve the Plaid Link page."""
    return _CONNECT_HTML


@app.get("/oauth_callback", response_class=HTMLResponse)
async def oauth_callback():
    """Landing page after a bank OAuth redirect (e.g. Chase)."""
    return _OAUTH_HTML


@app.post("/api/link_token")
async def api_link_token():
    """Create and return a fresh Plaid link_token."""
    try:
        token = create_link_token()
        return JSONResponse({"link_token": token})
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/exchange")
async def api_exchange(request: Request):
    """Exchange a public_token, save the access_token, return success."""
    try:
        body             = await request.json()
        public_token     = body["public_token"]
        institution_name = body.get("institution_name", "Unknown")
        exchange_and_save(public_token, institution_name)
        return JSONResponse({"ok": True})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)
