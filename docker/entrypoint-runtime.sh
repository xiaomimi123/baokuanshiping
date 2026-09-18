#!/bin/bash
set -euo pipefail
mkdir -p /projects/default
/usr/local/bin/sync-providers.sh
cd /projects/default
if [ ! -f hypit.runtime.json ]; then cp /opt/runtime.docker.json hypit.runtime.json; fi
node /opt/hypit/bin/hypit.mjs runtime use hypit.runtime.json
# 容器刚启动时不可能有存活的 Worker（PID 命名空间是新的），但上次运行遗留的
# worker.json 里的旧 PID 可能恰好撞上本命名空间里的无关进程，让 runtime up
# 误判 Worker 已在运行而跳过启动。先清掉陈旧状态再 up。
rm -f .hypit/runtimes/local/worker/worker.json .hypit/runtimes/local/worker/ready
node /opt/hypit/bin/hypit.mjs runtime up
echo "Runtime worker ready; tailing"
exec tail -f /dev/null
