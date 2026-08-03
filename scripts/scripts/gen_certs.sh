#!/usr/bin/env bash
# Generate self-signed TLS cert for local HTTPS (dev only)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/certs"
cd "$ROOT/certs"

if [[ -f server.crt && -f server.key ]]; then
  echo "✓ certs/server.crt and server.key already exist"
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server.key \
  -out server.crt \
  -days 365 \
  -subj "/CN=localhost/O=YourShop.Id/C=ID" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 server.key
echo "✓ Generated certs/server.crt + server.key (self-signed, 365 days)"
echo "  Start with:  YSI_HTTPS=1 ./server"
echo "  Frontend config.js apiBase: 'https://localhost:8443/api'"
echo "  Browser will warn about self-signed cert — accept for local dev."
