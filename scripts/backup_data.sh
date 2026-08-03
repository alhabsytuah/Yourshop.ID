#!/usr/bin/env bash
# Backup ysi_data.json / ysi_data.db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "$ROOT/backups"
if [[ -f "$ROOT/ysi_data.json" ]]; then
  cp -a "$ROOT/ysi_data.json" "$ROOT/backups/ysi_data_${TS}.json"
  echo "✓ Backed up ysi_data.json → backups/ysi_data_${TS}.json"
fi
if [[ -f "$ROOT/ysi_data.db" ]]; then
  cp -a "$ROOT/ysi_data.db" "$ROOT/backups/ysi_data_${TS}.db"
  echo "✓ Backed up ysi_data.db → backups/ysi_data_${TS}.db"
fi
ls -la "$ROOT/backups" 2>/dev/null | tail -5 || true
