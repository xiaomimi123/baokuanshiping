#!/bin/bash
# 由 entrypoint-runtime.sh / entrypoint-workbench.sh 在启动时调用。
# /projects 是宿主 bind mount（首次启动时可能是全新的空卷），
# 镜像内 /opt/workbench-providers 是构建期编译好的 provider 包种子（见 Dockerfile）。
# 这里只在目标缺失时同步，不覆盖宿主机已有源码/产物（保持“Profile 缺失才复制模板”的同一原则）。
set -euo pipefail

mkdir -p /projects/default/packages

if [ ! -f /projects/default/package.json ]; then
  cp /opt/workbench-providers/package.json /projects/default/package.json
fi

for pkg_dir in /opt/workbench-providers/packages/*/; do
  name="$(basename "$pkg_dir")"
  dest="/projects/default/packages/$name"
  if [ ! -d "$dest" ] || [ ! -d "$dest/dist" ]; then
    mkdir -p "$dest"
    cp -rn "$pkg_dir"* "$dest/"
  fi
done

# SDK symlink：每次启动都重建（宿主机开发用 scripts/setup-providers.sh 做同样的事）。
mkdir -p /projects/default/node_modules/@hypit
ln -sfn /opt/hypit /projects/default/node_modules/@hypit/hypit
# 测试基建（provider 包单测用 @hypit/driver-node 的 EndpointRegistry + MemoryResourceStore）需要，与宿主机一致。
ln -sfn /opt/hypit/packages/driver-node /projects/default/node_modules/@hypit/driver-node
