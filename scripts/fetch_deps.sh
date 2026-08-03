#!/usr/bin/env bash
# Download single-header dependencies for server.cpp
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HTTPLIB_URL="https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.14.3/httplib.h"
JSON_URL="https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$out" "$url"
  else
    echo "Need curl or wget to download $out" >&2
    exit 1
  fi
}

if [[ ! -f httplib.h ]]; then
  echo "→ Downloading httplib.h ..."
  download "$HTTPLIB_URL" httplib.h
else
  echo "✓ httplib.h already present"
fi

if [[ ! -f json.hpp ]]; then
  echo "→ Downloading json.hpp ..."
  download "$JSON_URL" json.hpp
else
  echo "✓ json.hpp already present"
fi

echo "✓ Dependencies ready in $ROOT"
