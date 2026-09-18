# 构建上下文 = 仓库父目录（hpyit爆款视频复刻/），见 compose 的 context: ../..
# （相对 docker-compose.yml 所在目录 docker/ 计算，".." 会解析成 hypit-workbench/，故需 "../.."）
FROM node:22-bookworm

RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 update \
    && ( ok=0; for i in 1 2 3 4 5; do \
         apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 install -y --no-install-recommends \
           chromium python3 socat curl ca-certificates git && ok=1 && break; \
         echo "apt-get install retry $i failed, keeping cached .deb files and retrying..."; sleep 5; \
       done; test "$ok" = "1" ) \
    && rm -rf /var/lib/apt/lists/*
# ffmpeg：不用 bookworm 自带的 5.1.9——实测它在本镜像（aarch64）上有个 AAC 编码时长舍入 bug：
# 用 `-c:a aac` 把一段精确 8s（384000 samples@48kHz）的静音音轨编码进 mp4 后，ffprobe 量出的音轨
# 时长变成 7.936s（少 3072 samples），比预期短 0.064s。hypit `executeMuxProgramMedia` 对最终 mux
# 产物做严格的采样数校验（容不下 1 个采样的误差），因而任何带音轨的 Build（含创作页 chat 模板的
# 静音占位音轨）在最后一步 100% 失败，报 "Final mux audio presentation span differs from
# TimelineAudio"（渲染帧本身完全正常，只坏在这最后一次 mux）。手工用同一条 ffmpeg 命令对比过
# Debian trixie 的 ffmpeg 7.1.5——量出精确的 8.000000s，问题已在上游修复。
# 如实说明（I5）：`-t trixie ffmpeg` 不是"只装 ffmpeg 一个包"——apt 依赖解析会连带把
# libavcodec61 等一批依赖也从 trixie 装（或升级），其中包括 libc6/glibc、base-files 等基础包，
# 结果容器内 `cat /etc/debian_version`／`os-release` 会自报 Debian 13（trixie），而不是 bookworm。
# 这是一次有意为之的、局部但确实跨发行版的升级：只为解决上面这个 ffmpeg bug，接受"基础库版本
# 与镜像标签不完全一致"的代价，而非把整个系统升级到 trixie。装完即删 sources.list.d/trixie.list，
# 防止后续任何 `apt-get upgrade`/`install`（未来维护者添加的新 RUN 层）意外从 trixie 漂移拉取
# 更多包——trixie 源只在这一层临时启用。
RUN echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list \
    && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 update \
    && ( ok=0; for i in 1 2 3 4 5; do \
         apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 install -y --no-install-recommends -t trixie ffmpeg \
           && ok=1 && break; \
         echo "apt-get install ffmpeg(trixie) retry $i failed, retrying..."; sleep 5; \
       done; test "$ok" = "1" ) \
    && rm -rf /var/lib/apt/lists/* \
    && rm /etc/apt/sources.list.d/trixie.list
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
# I-1 修复引入的匿名卷挂载点：Docker 给匿名卷分配存储时按镜像内该路径已有的属主/权限初始化
# 内容；这里预先建好目录并 chown 给 node，容器才能以非 root 的 node 用户在
# /projects/default/node_modules 下建 symlink（否则匿名卷会以 root:root 初始化，
# entrypoint 里的 mkdir -p 会 Permission denied）。
RUN mkdir -p /projects/default/node_modules && chown -R node:node /projects

USER node
ENV HYPIT_REPO=/opt/hypit HYPIT_PROJECT=/projects/default
