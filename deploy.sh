#!/bin/bash
# deploy.sh — rsync-based deploy to a remote server running moneytalks via systemd.
# Copy this file and fill in your server details before use.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy.env
[ -f "$SCRIPT_DIR/deploy.env" ] && source "$SCRIPT_DIR/deploy.env"

SERVER="${MONEYTALKS_SERVER:?Set MONEYTALKS_SERVER in deploy.env or as an env var}"
APP="${MONEYTALKS_APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"

echo "=== Building frontend ==="
cd "$APP/frontend" && npm run build && cd "$APP"

echo "=== Syncing code ==="
rsync -a "$APP/server.py" "$APP/requirements.txt" "$APP/user_rules.py" "$SERVER:/opt/moneytalks/app/"
rsync -a "$APP/routes/" "$SERVER:/opt/moneytalks/app/routes/"
rsync -a "$APP/core/" "$SERVER:/opt/moneytalks/app/core/"
rsync -a "$APP/categorizer/" "$SERVER:/opt/moneytalks/app/categorizer/"
rsync -a "$APP/frontend/dist/" "$SERVER:/opt/moneytalks/app/frontend/dist/"

echo "=== Restarting server ==="
ssh "$SERVER" "sudo systemctl restart moneytalks"

echo "=== Done ==="
