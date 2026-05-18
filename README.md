# MoneyTalks

A self-hosted personal finance dashboard. Connect your bank accounts via Plaid, upload CSVs, and let a local AI (Ollama) categorize everything — all running on your own hardware with no data leaving your network.

---

## Features

- **Bank sync** — Connect Chase, Amex, Wealthfront, and 10,000+ institutions via Plaid. Auto-syncs every 24 hours.
- **CSV upload** — Drop in a Chase Bank, Chase Credit Card, or Amex CSV export and it parses automatically.
- **AI categorization** — Uses a local Ollama model (llama3.2) to categorize transactions. Falls back to Claude or Gemini if configured. Your data never leaves your machine with Ollama.
- **Review queue** — Every new transaction goes through a review step before it's finalized. AI pre-fills the category; you confirm or correct it.
- **Your edits are permanent** — Manually set categories are never overwritten by syncs or re-categorization.
- **Monthly breakdown** — Spending by category, income vs. expenses, month-over-month trends.
- **Net Worth** — Live balances from all linked accounts including investment accounts (Wealthfront, etc.).
- **Recurring transactions** — Automatically detected subscriptions and bills.
- **Budgets** — Set monthly limits per category.
- **Semantic search** — Search transactions by meaning, not just keyword (e.g. "coffee shops last month").
- **Multi-user** — First account becomes admin and can create accounts for others (e.g. a partner).
- **Self-hosted** — Runs entirely on your own hardware via Docker. No SaaS, no subscription.

---

## Deploy (Docker — recommended)

The only requirement is **Docker Desktop**.

### 1. Clone and start

```bash
git clone https://github.com/vedantbajaj96/finance-dashboard.git
cd finance-dashboard
docker compose up -d
```

The first build takes ~3 minutes (downloads dependencies). Subsequent starts are instant.

### 2. Pull the AI model

```bash
docker compose exec ollama ollama pull llama3.2
```

Only needed once. The model is stored in a Docker volume and persists across restarts.

### 3. Open the app

Visit **http://localhost:8502**

The first account you register becomes the admin.

---

## Getting started (first time)

Once the app is running and you've registered your account:

### Option A — Connect your bank via Plaid (recommended)

1. Go to **Settings** and enter your Plaid API keys (get them free at [dashboard.plaid.com](https://dashboard.plaid.com) — use Sandbox for testing, Production for real banks).
2. Go to the **Accounts** tab and click **Link a bank account**.
3. Search for your bank, log in, and select the accounts to connect.
4. Click **Sync now** — transactions from the last 90 days are imported automatically.
5. Plaid syncs automatically every 24 hours after that.

### Option B — Upload a CSV export

If you don't want to use Plaid, export a CSV from your bank and upload it in **Settings → Upload Bank CSV**.

Supported formats out of the box:
- Chase Bank (checking/savings)
- Chase Credit Card
- American Express

### After importing

1. Open the **Review** tab — your transactions are waiting with AI-suggested categories.
2. Confirm or correct each one. Any category you set manually is locked and will never be overwritten.
3. That's it — the **Monthly**, **Trends**, and **Net Worth** tabs will populate as you approve transactions.

> **Adding a partner?** Log out, register a second account — it gets its own separate data. The first account you created is the admin and can manage users.

---

## Security

- **Keep it on localhost or Tailscale.** The app is designed for personal/household use on a trusted private network. Tailscale is the recommended way to access it remotely — traffic is encrypted at the network layer so plain HTTP is fine.
- **If you expose it publicly** (e.g. behind a reverse proxy with a real domain and TLS certificate), set the `SECURE_COOKIES=true` environment variable so session cookies are HTTPS-only. Add it to `docker-compose.yml` under `environment:`.
- **Plaid access tokens and API keys** are stored in the Docker volume on your own machine and are never sent anywhere except the respective APIs (Plaid, Ollama runs fully locally).

---

## Remote access (Tailscale)

To access from your phone or another computer:

1. Install [Tailscale](https://tailscale.com) on the server and your devices — log in with the same account.
2. Access the app at `http://<server-hostname>:8502` from anywhere on your Tailscale network.
3. If using Plaid with OAuth banks (Chase, Amex, BofA), set the redirect URI in Settings to your Tailscale URL.

---

## Running on Windows as a permanent server

### Prevent the machine from sleeping

The app needs to stay running. In **Settings → Power & Sleep**, set both "Screen" and "Sleep" to **Never** when plugged in.

### Data migration (one-time, from another machine)

If you have existing data on another machine, zip it up and copy it to the Windows Docker volume:

**On your old machine:**
```bash
cd /path/to/finance-dashboard
zip -r data_backup.zip data/
```

Transfer `data_backup.zip` to the Windows machine (USB, shared folder, etc.), unzip it, then copy into the running container:

```powershell
# Get the container name
docker compose ps

# Copy data into the container
docker cp data/. <moneytalks-container-name>:/app/data/
```

### Auto-deploy (optional)

The included `scripts/auto-deploy.ps1` polls GitHub every 5 minutes and rebuilds the Docker stack when new commits land.

**One-time setup** — run as Administrator in the repo folder:

```powershell
$dir = (Get-Location).Path
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NonInteractive -File `"$dir\scripts\auto-deploy.ps1`"" `
  -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MoneyTalks AutoDeploy" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
```

Deploys are logged to `deploy.log`. If nothing has changed, the script exits silently.

---

## Local development (Mac / Linux)

```bash
# Install dependencies
pip install -r requirements.txt
cd moneytalks && npm install && cd ..

# Run
python server.py
```

Requires Python 3.11+, Node.js 20+, and [Ollama](https://ollama.com) running locally with `llama3.2` pulled.

---

## Configuration

All settings are in the app under **Settings**:

| Setting | What it's for |
|---|---|
| Plaid keys | Link bank accounts for automatic sync |
| Anthropic / Gemini key | Optional cloud LLM fallback for categorization |
| Preferred provider | `ollama` (local), `claude`, or `gemini` |
| OAuth redirect URI | Required for OAuth banks (Chase, Amex, etc.) |

User data is stored in `data/<username>/` — transactions as Parquet, config as JSON. The `data/` directory is gitignored and never leaves your machine.

---

## Tech stack

- **Backend** — Python, FastAPI, DuckDB, pandas, Plaid SDK
- **Frontend** — React (served as JSX, compiled at startup via Babel)
- **AI** — Ollama (llama3.2), with Claude / Gemini as optional fallbacks
- **Search** — sentence-transformers (all-MiniLM-L6-v2), runs locally
- **Storage** — Parquet files via PyArrow, no external database required
