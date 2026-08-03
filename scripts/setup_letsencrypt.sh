#!/usr/bin/env bash
# YourShop.Id — Let's Encrypt (certbot) setup
# Prasyarat: domain mengarah ke server ini (A/AAAA record), port 80 terbuka
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash scripts/setup_letsencrypt.sh <domain> <email>"
  echo "  e.g. sudo bash scripts/setup_letsencrypt.sh yourshop.example.com admin@example.com"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan sebagai root (sudo)"
  exit 1
fi

echo "==> Domain: $DOMAIN  Email: $EMAIL"

# Install certbot + nginx plugin if missing
if ! command -v certbot >/dev/null 2>&1; then
  echo "==> Installing certbot..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx
  else
    echo "Install certbot manual, lalu jalankan ulang skrip ini."
    exit 1
  fi
fi

mkdir -p /var/www/certbot /var/www/yourshop

# Temporary nginx server for ACME if full site not ready
if ! nginx -t 2>/dev/null; then
  echo "Peringatan: nginx config belum valid — pastikan yourshop.conf sudah di-install."
fi

# Obtain certificate (nginx plugin manages config)
echo "==> Requesting certificate..."
certbot --nginx \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --redirect \
  --non-interactive || {
    echo ""
    echo "Jika gagal, coba webroot mode:"
    echo "  certbot certonly --webroot -w /var/www/certbot -d $DOMAIN --email $EMAIL --agree-tos"
    exit 1
  }

# Auto-renew timer (systemd)
systemctl enable --now certbot.timer 2>/dev/null || true

echo ""
echo "✓ Sertifikat Let's Encrypt untuk $DOMAIN"
echo "  Live:   /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  Key:    /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo "  Renew:  certbot renew --dry-run"
echo ""
echo "Update nginx/yourshop.conf server_name + ssl_certificate paths ke $DOMAIN"
echo "Lalu: nginx -t && systemctl reload nginx"
