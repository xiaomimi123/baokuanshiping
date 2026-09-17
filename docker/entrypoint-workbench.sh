#!/bin/bash
set -euo pipefail
mkdir -p /projects/default
/usr/local/bin/sync-providers.sh
cd /projects/default
if [ ! -f hypit.runtime.json ]; then cp /opt/runtime.docker.json hypit.runtime.json; fi
node /opt/hypit/bin/hypit.mjs runtime use hypit.runtime.json || true
# Studio 只监听 127.0.0.1，转发到 0.0.0.0:5179 供宿主访问（Studio 实际用 5180 内部端口）
socat TCP-LISTEN:5179,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:5180 &
cd /opt/workbench
# pnpm 生成的 .bin/tsx 是可执行的 shell trampoline 脚本，不能用 `node` 去解释它
exec server/node_modules/.bin/tsx server/src/index.ts
