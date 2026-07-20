#!/bin/bash
set -euo pipefail
exec > /var/log/cloud-init-moneytalks.log 2>&1

echo "=== MoneyTalks cloud-init starting ==="

# ── System update ─────────────────────────────────────────────────
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# ── Docker ───────────────────────────────────────────────────────
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# ── Tailscale ────────────────────────────────────────────────────
curl -fsSL https://tailscale.com/install.sh | sh
# --ssh enables Tailscale SSH (lets you drop regular SSH access later)
tailscale up \
  --authkey "${tailscale_auth_key}" \
  --hostname moneytalks \
  --ssh

# ── Data volume ──────────────────────────────────────────────────
# Wait for the block volume to appear (attached after boot)
for i in $(seq 1 30); do
  if [ -b "${data_device}" ]; then break; fi
  echo "Waiting for data volume... ($i/30)"
  sleep 5
done

if [ -b "${data_device}" ]; then
  # Format only if not already formatted (safe for existing volumes)
  if ! blkid "${data_device}"; then
    mkfs.ext4 -F "${data_device}"
  fi
  mkdir -p /opt/moneytalks/data
  # Add to fstab for automatic remount on reboot
  BLKID=$(blkid -s UUID -o value "${data_device}")
  if ! grep -q "$BLKID" /etc/fstab; then
    echo "UUID=$BLKID /opt/moneytalks/data ext4 defaults,nofail 0 2" >> /etc/fstab
  fi
  mount -a
  echo "Data volume mounted at /opt/moneytalks/data"
else
  echo "WARNING: data volume not found, using boot disk (not recommended)"
  mkdir -p /opt/moneytalks/data
fi

# ── App directory ─────────────────────────────────────────────────
mkdir -p /opt/moneytalks
chmod 700 /opt/moneytalks/data

# ── Environment file ─────────────────────────────────────────────
cat > /opt/moneytalks/.env <<ENV
SECRET_KEY=${app_secret_key}
PLAID_CLIENT_ID=${plaid_client_id}
PLAID_SECRET=${plaid_secret}
ENV
chmod 600 /opt/moneytalks/.env

# ── Docker Compose ───────────────────────────────────────────────
cat > /opt/moneytalks/docker-compose.yml <<'COMPOSE'
services:
  moneytalks:
    image: ${docker_image}
    # Bind to localhost only — Tailscale handles external access
    ports:
      - "127.0.0.1:8502:8502"
    volumes:
      - ./data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8502').read()"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
COMPOSE

# ── Pull and start ───────────────────────────────────────────────
cd /opt/moneytalks
docker compose pull
docker compose up -d

# ── Tailscale HTTPS serve ────────────────────────────────────────
# Exposes the app at https://moneytalks.YOUR-TAILNET.ts.net
tailscale serve --bg 8502

# ── Daily backup to local directory ──────────────────────────────
# Simple daily snapshot — expand to Object Storage later if needed
mkdir -p /opt/backups/moneytalks
cat > /usr/local/bin/backup-moneytalks <<'BACKUP'
#!/bin/bash
STAMP=$(date +%Y%m%d_%H%M)
tar -czf /opt/backups/moneytalks/data_$${STAMP}.tar.gz -C /opt/moneytalks data/
# Keep only last 14 backups
ls -t /opt/backups/moneytalks/data_*.tar.gz | tail -n +15 | xargs -r rm
echo "Backup complete: data_$${STAMP}.tar.gz"
BACKUP
chmod +x /usr/local/bin/backup-moneytalks

# Run daily at 3am
echo "0 3 * * * root /usr/local/bin/backup-moneytalks" > /etc/cron.d/moneytalks-backup

# ── Update helper ────────────────────────────────────────────────
cat > /usr/local/bin/update-moneytalks <<'UPDATE'
#!/bin/bash
cd /opt/moneytalks
docker compose pull
docker compose up -d
echo "MoneyTalks updated."
UPDATE
chmod +x /usr/local/bin/update-moneytalks

echo "=== MoneyTalks cloud-init complete ==="
