#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x ./server ]]; then
  make -j"$(nproc 2>/dev/null || echo 2)"
fi
exec ./server
