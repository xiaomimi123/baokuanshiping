#!/bin/bash
set -euo pipefail
base=http://127.0.0.1:8090
for path in /api/health /api/runtime/status /api/doctor /api/builds /api/profile /api/studio; do
  echo "== GET $path"
  curl -fsS "$base$path" | head -c 300; echo
done

echo "== assert /api/runtime/status ready:true"
status_json="$(curl -fsS "$base/api/runtime/status")"
if ! echo "$status_json" | grep -q '"ready":true'; then
  echo "FAIL: /api/runtime/status did not report ready:true" >&2
  echo "$status_json" >&2
  exit 1
fi

echo "SMOKE OK"
