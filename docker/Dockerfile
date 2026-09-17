# 构建上下文 = 仓库父目录（hpyit爆款视频复刻/），见 compose 的 context: ../..
# （相对 docker-compose.yml 所在目录 docker/ 计算，".." 会解析成 hypit-workbench/，故需 "../.."）
FROM node:22-bookworm

RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 update \
    && ( ok=0; for i in 1 2 3 4 5; do \
         apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 install -y --no-install-recommends \
           chromium ffmpeg python3 socat curl ca-certificates git && ok=1 && break; \
         echo "apt-get install retry $i failed, keeping cached .deb files and retrying..."; sleep 5; \
       done; test "$ok" = "1" ) \
    && rm -rf /var/lib/apt/lists/*
# uv（WhisperX 等 Managed Program 需要；官方安装脚本）
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
# Docker 内默认 seccomp 禁用户命名空间，chromium 需 --no-sandbox 包装
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/chromium-nosandbox \
    && chmod +x /usr/local/bin/chromium-nosandbox

RUN corepack enable
ENV CI=true
WORKDIR /opt/hypit
COPY hypit/ ./
RUN pnpm install --frozen-lockfile

WORKDIR /opt/workbench
COPY hypit-workbench/package.json hypit-workbench/pnpm-workspace.yaml hypit-workbench/pnpm-lock.yaml ./
COPY hypit-workbench/server/package.json server/
COPY hypit-workbench/web/package.json web/
RUN pnpm install --frozen-lockfile
COPY hypit-workbench/server/ server/
COPY hypit-workbench/web/ web/
RUN pnpm --filter @workbench/web build

# 直连 Provider 包（源码入库，见 hypit-workbench/projects/default/packages）：
# 镜像内种子目录 /opt/workbench-providers，供 entrypoint 首次同步到 /projects/default（bind mount）。
# 编译期只需 typecheck+emit，不跑 pnpm install：SDK 用 symlink 指向 /opt/hypit（源码即类型，见 spec §7），
# @types/node 借用 workbench 已装的（server/node_modules/@types，ancestor 目录，tsc 默认 typeRoots 会向上找）。
COPY hypit-workbench/projects/default/ /opt/workbench-providers/
RUN mkdir -p /opt/workbench-providers/node_modules/@hypit \
    && ln -sfn /opt/hypit /opt/workbench-providers/node_modules/@hypit/hypit \
    && ln -sfn /opt/workbench/server/node_modules/@types /opt/workbench-providers/node_modules/@types \
    && for pkg in /opt/workbench-providers/packages/*/; do \
         echo "building provider package: $pkg"; \
         node /opt/workbench/server/node_modules/typescript/bin/tsc -p "${pkg}tsconfig.json"; \
       done

COPY hypit-workbench/docker/sync-providers.sh /usr/local/bin/sync-providers.sh
COPY hypit-workbench/docker/entrypoint-runtime.sh /usr/local/bin/entrypoint-runtime.sh
COPY hypit-workbench/docker/entrypoint-workbench.sh /usr/local/bin/entrypoint-workbench.sh
COPY hypit-workbench/docker/runtime.docker.json /opt/runtime.docker.json
RUN chmod +x /usr/local/bin/*.sh && chown -R node:node /opt

USER node
ENV HYPIT_REPO=/opt/hypit HYPIT_PROJECT=/projects/default
