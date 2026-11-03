#!/bin/bash
# Install or update gnv-catalog-mcp on a Debian/Ubuntu host with systemd, nginx and certbot.
# Run as root from a checkout of this repository:  sudo deploy/install.sh
# Idempotent: safe to run again for an update. It never overwrites an existing /etc/gnv-catalog-mcp/env.
# nginx and certbot are only touched when DNS for the domain already points to this host.
set -euo pipefail

DOMAIN=catalog-mcp.goodnaturevibe.com
SVC_USER=gnvcatalog
BASE=/opt/gnv-catalog-mcp
APP=$BASE/app
ETC=/etc/gnv-catalog-mcp
UNIT=gnv-catalog-mcp.service
PORT=8325
SRC="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -f "$SRC/src/main.js" ] || { echo "run from a checkout of gnv-catalog-mcp"; exit 1; }
command -v node >/dev/null || { echo "node is missing"; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { echo "node >= 18 is required, found $(node -v)"; exit 1; }
[ "$(command -v node)" = /usr/bin/node ] || echo "note: the unit uses /usr/bin/node, PATH has $(command -v node)"

# 1. Service user without login or home.
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SVC_USER"
fi

# 2. Code, owned by root and read-only for the service.
install -d -o root -g root -m 0755 "$BASE" "$APP"
rsync -a --delete --exclude .git --exclude node_modules "$SRC/" "$APP/"
chown -R root:root "$APP"
chmod -R u+rwX,go+rX,go-w "$APP"

# 3. Environment file, only created if absent.
install -d -o root -g "$SVC_USER" -m 0750 "$ETC"
if [ ! -f "$ETC/env" ]; then
  install -o root -g "$SVC_USER" -m 0640 "$SRC/deploy/env.example" "$ETC/env"
  echo "created $ETC/env from env.example"
fi

# 4. systemd unit and log rotation.
install -o root -g root -m 0644 "$SRC/deploy/$UNIT" "/etc/systemd/system/$UNIT"
if [ -d /etc/logrotate.d ]; then
  install -o root -g root -m 0644 "$SRC/deploy/logrotate-gnv-catalog-mcp" /etc/logrotate.d/gnv-catalog-mcp
fi
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { echo "service did not answer on /healthz"; systemctl status "$UNIT" --no-pager || true; exit 1; }
echo "service up on 127.0.0.1:$PORT"

# 5. nginx vhost and certificate, only when DNS points here.
dns_points_here() {
  local resolved local_ips ip
  resolved=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u)
  local_ips=$(hostname -I 2>/dev/null || true)
  [ -n "$resolved" ] || return 1
  for ip in $resolved; do
    case " $local_ips " in *" $ip "*) ;; *) return 1 ;; esac
  done
  return 0
}

VHOST=/etc/nginx/sites-available/$DOMAIN
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem

if ! command -v nginx >/dev/null; then
  echo "nginx not installed; skipping vhost"
  exit 0
fi

if [ -f "$CERT" ]; then
  install -o root -g root -m 0644 "$SRC/deploy/nginx-catalog-mcp.conf" "$VHOST"
  ln -sf "$VHOST" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t && systemctl reload nginx
  echo "nginx vhost for $DOMAIN active"
  exit 0
fi

if ! dns_points_here; then
  echo "DNS for $DOMAIN does not point to this host yet; skipping nginx and certbot. Run this script again after the DNS change."
  exit 0
fi

# Temporary HTTP-only server block so certbot can answer the challenge, then the full vhost.
cat > "$VHOST" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    server_tokens off;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
EOF
ln -sf "$VHOST" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx
certbot certonly --nginx -d "$DOMAIN" --non-interactive --keep-until-expiring
install -o root -g root -m 0644 "$SRC/deploy/nginx-catalog-mcp.conf" "$VHOST"
nginx -t && systemctl reload nginx
echo "certificate issued and nginx vhost for $DOMAIN active"
