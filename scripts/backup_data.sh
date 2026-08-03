#!/usr/bin/env bash
# Backup ysi_data.json / ysi_data.db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p backups
if [[ -f ysi_data.json ]]; then
  cp -a ysi_data.json "backups/ysi_data_${STAMP}.json"
  echo "✓ backups/ysi_data_${STAMP}.json"
fi
if [[ -f ysi_data.db ]]; then
  cp -a ysi_data.db "backups/ysi_data_${STAMP}.db"
  echo "✓ backups/ysi_data_${STAMP}.db"
fi
ls -1t backups/ysi_data_* 2>/dev/null | tail -n +21 | xargs -r rm -f
echo "Done. Restore: cp backups/FILE ysi_data.json"
