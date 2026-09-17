#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
hypit="${HYPIT_REPO:-$here/../hypit}"
if [ ! -f "$hypit/package.json" ]; then
  echo "错误：未在 $hypit 找到 package.json，无法链接 @hypit/hypit。" >&2
  echo "当前 HYPIT_REPO=${HYPIT_REPO:-<未设置，默认使用 $here/../hypit>}" >&2
  echo "请设置 HYPIT_REPO 指向 hypit 仓库根目录（该目录需与 hypit-workbench 同级，或显式导出 HYPIT_REPO）。" >&2
  exit 1
fi
mkdir -p "$here/projects/default/node_modules/@hypit"
ln -sfn "$hypit" "$here/projects/default/node_modules/@hypit/hypit"
echo "linked @hypit/hypit -> $hypit"
# Test-only dependency: driver-node has no public subpath under @hypit/hypit's exports map
# (it is a separate upstream package), so provider test suites resolve it via this direct
# per-package symlink, mirroring how pnpm links it inside the upstream workspace itself.
ln -sfn "$hypit/packages/driver-node" "$here/projects/default/node_modules/@hypit/driver-node"
echo "linked @hypit/driver-node -> $hypit/packages/driver-node"
