#!/bin/bash
set -euo pipefail
exec > /var/log/cloud-init-moneytalks.log 2>&1

echo "=== MoneyTalks cloud-init starting ==="

# ── Swap (8GB — prevents OOM on 1GB RAM) ─────────────────────────
if [ ! -f /swapfile ]; then
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── Python 3.11 + Git ─────────────────────────────────────────────
dnf install -y python3.11 python3.11-pip git --disablerepo="*" --enablerepo="ol9_baseos_latest,ol9_appstream" --nobest --skip-broken

# ── Tailscale ────────────────────────────────────────────────────
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up \
  --authkey "${tailscale_auth_key}" \
  --hostname moneytalks \
  --ssh

# ── Data volume ──────────────────────────────────────────────────
# Find the data volume dynamically: the disk that has no partitions and is not the boot disk
find_data_dev() {
  local root_disk
  root_disk=$(lsblk -no pkname "$(findmnt -n -o SOURCE /)" 2>/dev/null | head -1)
  lsblk -d -o NAME,TYPE --noheadings | awk '$2=="disk"{print $1}' | while read -r disk; do
    [ "/dev/$disk" = "/dev/$root_disk" ] && continue
    # Has no children (no partitions/LVM) — it's our bare data volume
    children=$(lsblk -no NAME "/dev/$disk" 2>/dev/null | wc -l)
    if [ "$children" -eq 1 ]; then
      echo "/dev/$disk"
      return
    fi
  done
}

DATA_DEV=""
for i in $(seq 1 30); do
  DATA_DEV=$(find_data_dev)
  [ -n "$DATA_DEV" ] && break
  echo "Waiting for data volume... ($i/30)"
  sleep 5
done

if [ -n "$DATA_DEV" ]; then
  echo "Found data volume at $DATA_DEV"
  if ! blkid "$DATA_DEV" | grep -q ext4; then
    mkfs.ext4 -F "$DATA_DEV" || echo "mkfs skipped — disk already has data"
  fi
  mkdir -p /opt/moneytalks/data
  BLKID=$(blkid -s UUID -o value "$DATA_DEV")
  if ! grep -q "$BLKID" /etc/fstab; then
    echo "UUID=$BLKID /opt/moneytalks/data ext4 defaults,nofail 0 2" >> /etc/fstab
  fi
  mount -a
  echo "Data volume mounted at /opt/moneytalks/data"
else
  echo "WARNING: data volume not found, using boot disk"
  mkdir -p /opt/moneytalks/data
fi

# ── App directory ─────────────────────────────────────────────────
mkdir -p /opt/moneytalks/app
chown opc:opc /opt/moneytalks/app
chmod 700 /opt/moneytalks/data

# ── Python venv on data volume (survives VM recreations) ──────────
if [ ! -d /opt/moneytalks/data/venv ]; then
  python3.11 -m venv /opt/moneytalks/data/venv
  /opt/moneytalks/data/venv/bin/pip install --upgrade pip
  /opt/moneytalks/data/venv/bin/pip install \
    fastapi "uvicorn[standard]" pandas pyarrow duckdb \
    anthropic google-genai plaid-python fastembed \
    python-multipart slowapi pdfplumber yfinance scipy \
    python-dotenv
fi
chown -R opc:opc /opt/moneytalks/data/venv
  # Pre-download the embedding model so first server start is fast
  sudo -u opc /opt/moneytalks/data/venv/bin/python -c "from fastembed import TextEmbedding; list(TextEmbedding('BAAI/bge-base-en-v1.5').embed(['warmup']))" || true

# ── Environment file ─────────────────────────────────────────────
cat > /opt/moneytalks/.env <<ENV
SECRET_KEY=${app_secret_key}
PLAID_CLIENT_ID=${plaid_client_id}
PLAID_SECRET=${plaid_secret}
DATA_DIR=/opt/moneytalks/data
ENV
chmod 600 /opt/moneytalks/.env

# ── Systemd service ───────────────────────────────────────────────
cat > /etc/systemd/system/moneytalks.service <<'SERVICE'
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
SERVICE

systemctl daemon-reload
systemctl enable moneytalks

# ── Tailscale HTTPS serve ────────────────────────────────────────
tailscale serve --bg 8502

# ── Daily backup ─────────────────────────────────────────────────
mkdir -p /opt/backups/moneytalks
cat > /usr/local/bin/backup-moneytalks <<'BACKUP'
#!/bin/bash
STAMP=$(date +%Y%m%d_%H%M)
tar -czf /opt/backups/moneytalks/data_$${STAMP}.tar.gz -C /opt/moneytalks data/
ls -t /opt/backups/moneytalks/data_*.tar.gz | tail -n +15 | xargs -r rm
BACKUP
chmod +x /usr/local/bin/backup-moneytalks
echo "0 3 * * * root /usr/local/bin/backup-moneytalks" > /etc/cron.d/moneytalks-backup

echo "=== MoneyTalks cloud-init complete (deploy app code to /opt/moneytalks/app to start) ==="
