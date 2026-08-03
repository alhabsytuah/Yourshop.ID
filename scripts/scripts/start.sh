#!/usr/bin/env bash
set -euo pipefail
cd /app
mkdir -p data logs
./server &
API_PID=$!
python3 -m http.server "${WEB_PORT:-5500}" --bind 0.0.0.0 &
WEB_PID=$!
trap "kill $API_PID $WEB_PID 2>/dev/null" EXIT
wait
