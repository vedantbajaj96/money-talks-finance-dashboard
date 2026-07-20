#!/bin/bash
# Run this on the server to finish setup: bash setup-server.sh
set -e

SERVER_IP="YOUR_SERVER_IP"

echo "=== Setting up systemd service ==="
sudo tee /etc/systemd/system/moneytalks.service > /dev/null <<'EOF'
[Unit]
Description=MoneyTalks Finance Dashboard
After=network.target

[Service]
Type=simple
User=opc
WorkingDirectory=/opt/moneytalks/app
EnvironmentFile=/opt/moneytalks/.env
ExecStart=/opt/moneytalks/data/venv/bin/python server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable moneytalks
pkill -f server.py 2>/dev/null || true
sudo systemctl start moneytalks

echo "=== Done! Server running via systemd ==="
sudo systemctl status moneytalks --no-pager
