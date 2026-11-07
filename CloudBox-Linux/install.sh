#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/cloudbox"
DATA_DIR="/var/lib/cloudbox"
SERVICE_USER="cloudbox"

if [[ $EUID -ne 0 ]]; then
  echo "Please run install.sh as root (sudo ./install.sh)" >&2
  exit 1
fi

id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
cp -a ./. "$APP_DIR/"
chown -R root:root "$APP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 755 "$APP_DIR/bin/cloudbox"
chmod 755 "$APP_DIR/resources/bin/7za" 2>/dev/null || true

cd "$APP_DIR"
if [[ -f package.json ]]; then
  npm install --omit=dev --no-audit --no-fund
fi

install -m 644 "$APP_DIR/cloudbox.service" /etc/systemd/system/cloudbox.service
systemctl daemon-reload
systemctl enable cloudbox.service
systemctl restart cloudbox.service
echo "CloudBox installed. Check: systemctl status cloudbox"
echo "Data directory: $DATA_DIR"
