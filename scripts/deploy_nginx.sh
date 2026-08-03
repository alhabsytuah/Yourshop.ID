#!/usr/bin/env bash
# Install nginx config + static frontend for YourShop.Id
# Usage: sudo bash scripts/deploy_nginx.sh [domain]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-yourshop.example.com}"

if [[ $EUID -ne 0 ]]; then
  echo "Usage: sudo bash scripts/deploy_nginx.sh [domain]"
  exit 1
fi

command -v nginx >/dev/null || {
  apt-get update -qq && apt-get install -y -qq nginx
}

mkdir -p /var/www/yourshop /var/www/certbot /etc/nginx/snippets

# Frontend files
cp -f "$ROOT/index.html" "$ROOT/main.js" "$ROOT/config.js" "$ROOT/assets.js" /var/www/yourshop/
chown -R www-data:www-data /var/www/yourshop 2>/dev/null || true

# Proxy snippet
cp -f "$ROOT/nginx/yourshop-proxy.conf" /etc/nginx/snippets/yourshop-proxy.conf

# Site config — substitute domain
sed "s/yourshop.example.com/${DOMAIN}/g" "$ROOT/nginx/yourshop.conf" \
  > /etc/nginx/sites-available/yourshop

ln -sfn /etc/nginx/sites-available/yourshop /etc/nginx/sites-enabled/yourshop
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Until certs exist, use local HTTP-only config to avoid nginx -t failure
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Sertifikat belum ada — memasang config lokal HTTP dulu."
  cp -f "$ROOT/nginx/yourshop.local.conf" /etc/nginx/sites-available/yourshop
  ln -sfn /etc/nginx/sites-available/yourshop /etc/nginx/sites-enabled/yourshop
  echo "Setelah DNS siap: sudo bash scripts/setup_letsencrypt.sh $DOMAIN you@email.com"
  echo "Lalu pasang lagi: sudo bash scripts/deploy_nginx.sh $DOMAIN"
fi

nginx -t
systemctl reload nginx

echo "✓ nginx aktif"
echo "  Frontend: /var/www/yourshop"
echo "  API proxy: /api/ → 127.0.0.1:8080"
echo "  Pastikan ./server (atau systemd) berjalan di :8080"
echo "  YSI_CORS_ORIGINS=https://${DOMAIN}"
