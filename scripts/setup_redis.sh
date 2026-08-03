#!/usr/bin/env bash
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
  echo "Install Redis manual."
  exit 1
fi
if [[ -f /etc/redis/redis.conf ]]; then
  sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf || true
  systemctl restart redis-server 2>/dev/null || systemctl restart redis
fi
echo "✓ Redis on 127.0.0.1:6379"
echo "  export YSI_REDIS_URL=redis://127.0.0.1:6379"
