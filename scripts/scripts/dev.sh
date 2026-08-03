#!/usr/bin/env bash
# Run API (8080) + static frontend (5500) together
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-5500}"

if [[ ! -x ./server ]]; then
  echo "Building server..."
  make -C "$ROOT" all
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "→ API  http://localhost:${API_PORT}/api/health"
./server &
API_PID=$!
sleep 0.4

echo "→ Web  http://localhost:${WEB_PORT}/"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$WEB_PORT" --bind 127.0.0.1 &
  WEB_PID=$!
elif command -v python >/dev/null 2>&1; then
  python -m SimpleHTTPServer "$WEB_PORT" &
  WEB_PID=$!
else
  echo "python3 not found — open index.html manually or install Python."
  echo "API still running (PID $API_PID)."
  wait "$API_PID"
  exit 0
fi

echo ""
echo "========================================"
echo "  YourShop.Id dev stack"
echo "  Frontend: http://localhost:${WEB_PORT}/"
echo "  API:      http://localhost:${API_PORT}/api"
echo "  Demo:     buyer@demo.com / demo"
echo "  Ctrl+C to stop"
echo "========================================"
echo ""

wait
