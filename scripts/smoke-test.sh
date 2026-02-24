#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8085}"
echo "== health =="
curl -fsS "$BASE/health" | jq . || curl -fsS "$BASE/health"
echo "== launcher =="
curl -fsSI "$BASE/" | head -5
