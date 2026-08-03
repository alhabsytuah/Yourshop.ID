#!/usr/bin/env bash
# Generate self-signed certs for local HTTPS (dev only)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/certs"
if [[ -f "$ROOT/certs/server.crt" && -f "$ROOT/certs/server.key" ]]; then
  echo "Certs already exist in certs/"
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$ROOT/certs/server.key" \
  -out "$ROOT/certs/server.crt" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "✓ Generated certs/server.crt + certs/server.key"
