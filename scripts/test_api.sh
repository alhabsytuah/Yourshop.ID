#!/usr/bin/env bash
# Smoke tests against running API (default localhost:8080)
set -euo pipefail
BASE="${API_BASE:-http://127.0.0.1:8080/api}"
fail=0

check() {
  local name="$1" code="$2" expect="$3"
  if [[ "$code" == "$expect" ]]; then
    echo "✓ $name ($code)"
  else
    echo "✗ $name (got $code, want $expect)"
    fail=$((fail+1))
  fi
}

echo "== YourShop.Id API tests @ $BASE =="

code=$(curl -s -o /tmp/ysi_h.json -w "%{http_code}" "$BASE/health")
check "GET /health" "$code" "200"

code=$(curl -s -o /tmp/ysi_p.json -w "%{http_code}" "$BASE/products?page=1&limit=3")
check "GET /products paginated" "$code" "200"
python3 -c "import json;d=json.load(open('/tmp/ysi_p.json')); assert 'items' in d or isinstance(d,list)"

code=$(curl -s -o /tmp/ysi_l.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{\"email\":\"buyer@demo.com\",\"password\":\"demo\"}')
check "POST /auth/login" "$code" "200"
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/ysi_l.json')).get('token',''))" 2>/dev/null || true)
if [[ -z "$TOKEN" ]]; then
  echo "✗ login token missing"
  fail=$((fail+1))
else
  echo "✓ login token present"
fi

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' -d '{\"email\":\"x\",\"password\":\"bad\"}')
check "POST /auth/login invalid" "$code" "401"

if [[ -n "$TOKEN" ]]; then
  code=$(curl -s -o /tmp/ysi_me.json -w "%{http_code}" "$BASE/auth/me" \
    -H "Authorization: Bearer $TOKEN")
  check "GET /auth/me" "$code" "200"
fi

code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/categories")
check "GET /categories" "$code" "200"

if [[ $fail -eq 0 ]]; then
  echo "All tests passed"
  exit 0
else
  echo "$fail test(s) failed"
  exit 1
fi
