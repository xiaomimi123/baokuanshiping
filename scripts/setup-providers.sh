#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
hypit="${HYPIT_REPO:-$here/../hypit}"
mkdir -p "$here/projects/default/node_modules/@hypit"
ln -sfn "$hypit" "$here/projects/default/node_modules/@hypit/hypit"
echo "linked @hypit/hypit -> $hypit"
