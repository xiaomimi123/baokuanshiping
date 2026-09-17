#!/bin/bash
# 由 entrypoint-runtime.sh / entrypoint-workbench.sh 在启动时调用。
# /projects 是宿主 bind mount（首次启动时可能是全新的空卷），
# 镜像内 /opt/workbench-providers 是构建期编译好的 provider 包种子（见 Dockerfile）。
# 这里只在目标缺失时同步，不覆盖宿主机已有源码/产物（保持“Profile 缺失才复制模板”的同一原则）。
#
# 警告：这不是增量构建。判断条件只看某个包目录是否存在、是否有 dist/ 子目录，
# 不比较内容新旧。如果你在容器里改了某个 provider 包的 src/ 但没删/没建它自己的
# dist/，本脚本不会重新编译也不会同步——跑的还是旧 dist/，源码和产物会悄悄不一致；
# 如果手动删掉了某包的 dist/ 想“重新触发同步”，补回来的也是镜像构建时的旧版本
# dist，不是你改过的源码编译结果。改完源码后必须自己重建（宿主机 `pnpm
# providers:build`，或容器内对该包跑 `tsc -p tsconfig.json`），不要依赖这里的兜底。
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
