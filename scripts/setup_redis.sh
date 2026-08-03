#!/usr/bin/env bash
# Install & start Redis for YourShop.Id rate limiting
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Usage: sudo bash scripts/setup_redis.sh"
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq redis-server
  systemctl enable --now redis-server
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y redis
  systemctl enable --now redis
else
  echo "Package manager tidak dikenali — install Redis manual."
  exit 1
fi

# Bind localhost only (safe default)
if [[ -f /etc/redis/redis.conf ]]; then
  sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf || true
  sed -i 's/^protected-mode no/protected-mode yes/' /etc/redis/redis.conf || true
  systemctl restart redis-server 2>/dev/null || systemctl restart redis
fi

echo "✓ Redis running on 127.0.0.1:6379"
echo "  Export for API:"
echo "    export YSI_REDIS_URL=redis://127.0.0.1:6379"
echo "  Then start: ./server"
redis-cli ping || true
