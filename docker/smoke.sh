#!/bin/bash
set -euo pipefail
base=http://127.0.0.1:8090
for path in /api/health /api/runtime/status /api/doctor /api/builds /api/profile /api/studio; do
  echo "== GET $path"
  curl -fsS "$base$path" | head -c 300; echo
done
echo "SMOKE OK"
