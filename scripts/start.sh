#!/usr/bin/env bash
# One-shot: deps → build → run API only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/fetch_deps.sh
make -C "$ROOT" all
echo ""
echo "Starting YourShop.Id API on http://localhost:8080"
echo "Open index.html via:  python3 -m http.server 5500"
echo "Or run full stack:    make dev"
echo ""
exec ./server
