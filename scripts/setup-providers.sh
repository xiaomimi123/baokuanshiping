#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
hypit="${HYPIT_REPO:-$here/../hypit}"
mkdir -p "$here/projects/default/node_modules/@hypit"
ln -sfn "$hypit" "$here/projects/default/node_modules/@hypit/hypit"
echo "linked @hypit/hypit -> $hypit"
# Test-only dependency: driver-node has no public subpath under @hypit/hypit's exports map
# (it is a separate upstream package), so provider test suites resolve it via this direct
# per-package symlink, mirroring how pnpm links it inside the upstream workspace itself.
ln -sfn "$hypit/packages/driver-node" "$here/projects/default/node_modules/@hypit/driver-node"
echo "linked @hypit/driver-node -> $hypit/packages/driver-node"
