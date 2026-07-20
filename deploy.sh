#!/bin/bash
set -e
SERVER="opc@YOUR_SERVER_IP"
APP="/Users/vedantbajaj/finance_dashboard"

echo "=== Building frontend ==="
cd "$APP/frontend" && npm run build && cd "$APP"

echo "=== Syncing code ==="
rsync -a "$APP/server.py" "$APP/requirements.txt" "$APP/user_rules.py" "$APP/config.json" "$SERVER:/opt/moneytalks/app/"
rsync -a "$APP/routes/" "$SERVER:/opt/moneytalks/app/routes/"
rsync -a "$APP/core/" "$SERVER:/opt/moneytalks/app/core/"
rsync -a "$APP/categorizer/" "$SERVER:/opt/moneytalks/app/categorizer/"
rsync -a "$APP/frontend/dist/" "$SERVER:/opt/moneytalks/app/frontend/dist/"

echo "=== Restarting server ==="
ssh "$SERVER" "sudo systemctl restart moneytalks"

echo "=== Done! https://moneytalks.YOUR-TAILNET.ts.net ==="
