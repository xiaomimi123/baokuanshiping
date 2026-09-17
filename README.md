# Hypit Workbench

面向 [Hypit](https://hypit.ai)（AI 视频生成 Distribution）的本地化 Web 工作台：一键用 Docker 把 Hypit Runtime 跑起来，并提供一个仿 hypit.ai 风格的可视化界面来配置模型服务、发起并追踪渲染任务、跳转官方 Studio 编辑器。

Hypit 本身（`../hypit`）是上游开源仓库，本项目**不修改其任何代码**，只通过其 CLI（`hypit.mjs`，全部走 `--json` 机器输出）驱动。

## 架构

```
hpyit爆款视频复刻/
├── hypit/                  # 上游源码（只读，不改动）
└── hypit-workbench/        # 本项目
    ├── docker/
    │   ├── Dockerfile              # node:22-bookworm + chromium + ffmpeg + python3/uv + socat
    │   ├── docker-compose.yml      # runtime + workbench 两个服务，共用一个镜像
    │   ├── entrypoint-runtime.sh   # runtime 服务：hypit runtime up，常驻
    │   ├── entrypoint-workbench.sh # workbench 服务：socat 转发 Studio + 起 Fastify 后端
    │   ├── runtime.docker.json     # 容器版 Runtime Profile 模板
    │   └── smoke.sh                # 冒烟测试脚本
    ├── server/                 # 后端：Fastify + TypeScript（tsx 直跑，无需编译）
    │   └── src/routes/         # runtime / builds / profile / auth / studio 五组路由
    └── web/                    # 前端：Vite + React + TypeScript
        └── src/pages/          # 总览 / 模型与服务 / 任务 / Studio 四个页面
```

Docker Compose 两个服务共享同一镜像：

| 服务 | 职责 | 对外端口（仅绑定 127.0.0.1） |
| --- | --- | --- |
| `runtime` | 执行 `hypit runtime up`，常驻 Runtime Worker（渲染、生图/视频/语音调用） | 无（仅供 `workbench` 服务通过共享卷/网络访问） |
| `workbench` | Fastify 后端（代理 hypit CLI）+ 内置静态前端；额外用 `socat` 把容器内 5180 端口的 Studio 转发到对外 5179 | 8090（工作台）、5179（Studio 转发） |

两个服务共享卷：
- `../projects → /projects`：视频项目目录，宿主机可直接看到产出文件
- `hypit-home`（named volume）：容器内 `/home/node`，持久化 Managed Programs 缓存、凭据文件等

## 快速开始

### 方式一：Docker（推荐）

```bash
cd docker
docker compose up -d --build
# 首次构建会安装 chromium/ffmpeg 等系统依赖，视网络情况需要 10-20 分钟
```

打开浏览器访问 `http://127.0.0.1:8090`。

停止：`docker compose down`（加 `-v` 会连同 `hypit-home` 卷一起删除，谨慎使用）。

冒烟测试（服务起来后）：

```bash
cd docker && bash smoke.sh
```

### 方式二：本机开发（不经 Docker）

前提：本机已有 `../hypit` 源码目录，且已安装 Chromium（`HYPERFRAMES` 本地渲染需要）。

```bash
nvm use 22
pnpm install
pnpm dev:server   # 终端一：启动后端 http://127.0.0.1:8090
pnpm dev:web      # 终端二：启动前端 dev server（Vite 代理到后端）
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HYPIT_REPO` | `../../hypit`（相对 `server/`） | 上游 Hypit 源码根目录，后端据此定位 `bin/hypit.mjs` |
| `HYPIT_PROJECT` | 同 `HYPIT_REPO` | Hypit 项目目录（`hypit.runtime.json`、Build 产物等所在目录） |
| `PORT` | `8090` | Workbench 后端 / 前端静态资源监听端口 |
| `STUDIO_PORT` | `5179` | 后端 spawn `hypit studio` 时使用的端口；Docker 中固定设为 `5180`，由 `socat` 转发到对外 `5179`（本机开发保持默认 `5179` 直连，无需转发） |

Docker 中 `HYPIT_REPO=/opt/hypit`、`HYPIT_PROJECT=/projects/default` 已在 `docker/Dockerfile` 中写死，一般无需覆盖。

## 模型与服务配置

Hypit 官方发行版中，所有生成模型（Seedance、Seedream、GPT Image、Nano Banana、Grok Imagine、MiniMax、ElevenLabs/FishAudio 语音、WhisperX 云端转写等）统一经由 `@hypit/provider-hypihub` 网关调用，不做任何厂商直连。

首次使用需要：

1. 打开工作台「模型与服务」页面
2. 填入 HypiHub 的 API Key（保存后走 `hypit auth login` 非交互登录，凭据以文件形式存放在容器内 `credentials/` 目录，随 `hypit-home` 卷持久化）
3. 可按需调整并发数、每模型能力并发

本地渲染（HyperFrames）与本地媒体处理不需要额外配置，容器内已固定使用 `chromium-nosandbox` 包装脚本 + 软件渲染（`browserGpu: "software"`）。

## 已知限制

- **Apple Silicon 上软件渲染较慢**：容器内 Chromium 因 Docker 默认 seccomp 禁用户命名空间而无法用 GPU/沙箱加速，`browserGpu` 固定为 `software`，HyperFrames 本地渲染耗时会明显长于宿主机原生浏览器。
- **Studio 经 socat 转发**：`hypit studio` 只能监听 `127.0.0.1`，无法直接对容器外暴露；`workbench` 服务用 `socat` 把内部 `5180` 转发到对外 `5179`，多一跳网络代理，属预期行为而非 bug。
- **凭据 file store 为明文卷**：容器内没有 OS 级钥匙串，`@hypit/credential-store-file` 把 API Key 明文存放在 `hypit-home` 卷下的 `credentials/` 目录中，仅适合本机单人使用场景，不要把该卷同步到不受信任的位置。
- **单人 / 无鉴权**：Compose 只绑定 `127.0.0.1`，不做多用户或登录鉴权，不要直接暴露到公网。

## 验证状态

<!-- 以下状态在实现 Docker 化任务时通过实际执行验证，如后续环境变化请重新核实 -->

- `docker compose build && docker compose up -d` 已在 Apple Silicon + Docker Desktop（linux/arm64 容器）上实际构建并启动成功。
- `docker/smoke.sh` 对 `/api/health`、`/api/runtime/status`、`/api/doctor`、`/api/builds`、`/api/profile`、`/api/studio` 六个接口的探测已跑通。
- `hypit doctor --json` 中浏览器诊断项已确认走 `chromium-nosandbox` 路径；HypiHub 未登录导致的 error 属预期（在「模型与服务」页填入 Key 后消失）。

如果你在其他环境（不同 CPU 架构、Docker 版本）上遇到构建失败，最常见原因是 apt 源瞬时 502（重试即可）或 `docker/docker-compose.yml` 中 `context` 路径与你的目录布局不一致——本仓库要求 `hypit-workbench` 与 `hypit` 是同级目录。
