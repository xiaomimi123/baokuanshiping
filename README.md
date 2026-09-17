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
    │   ├── Dockerfile.dockerignore # 构建时忽略的文件（配合根 Dockerfile）
    │   └── smoke.sh                # 冒烟测试脚本
    ├── server/                 # 后端：Fastify + TypeScript（tsx 直跑，无需编译）
    │   └── src/routes/         # runtime / builds / profile / auth / studio 五组路由
    ├── web/                    # 前端：Vite + React + TypeScript
    │   └── src/pages/          # 总览 / 模型与服务 / 任务 / Studio 四个页面
    └── projects/default/       # Hypit 项目本地包（git 跟踪源码，dist/ 不跟踪）
        └── packages/
            └── provider-openai-image/   # 直连 OpenAI 兼容生图 Provider（骨架，逻辑见 Task 2）
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
pnpm providers:setup   # 建 projects/default/node_modules/@hypit/hypit -> ../hypit 的 symlink（默认取 ../../hypit，可用 HYPIT_REPO 覆盖）
pnpm install
pnpm providers:build   # 编译 projects/default/packages/ 下的自建 Provider 包
pnpm dev:server   # 终端一：启动后端 http://127.0.0.1:8090
pnpm dev:web      # 终端二：启动前端 dev server（Vite 代理到后端）
```

`pnpm providers:setup`/`pnpm providers:build` 只在使用「自建直连 Provider」时需要（见下文「模型与服务配置」）；纯本地渲染场景可跳过。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HYPIT_REPO` | `../../hypit`（相对 `server/`） | 上游 Hypit 源码根目录，后端据此定位 `bin/hypit.mjs` |
| `HYPIT_PROJECT` | `<HYPIT_REPO 同级>/projects/default` | Hypit 项目目录（`hypit.runtime.json`、Build 产物等所在目录）；启动时若目录不存在会自动创建，默认值**从不指向上游仓库本身** |
| `PORT` | `8090` | Workbench 后端 / 前端静态资源监听端口 |
| `HOST` | `127.0.0.1` | Workbench 后端监听地址；仅在容器内（进程需要接受来自宿主机映射端口的连接）才应设为 `0.0.0.0`，本机直跑不要改 |
| `STUDIO_PORT` | `5179` | 后端 spawn `hypit studio` 时使用的端口；Docker 中固定设为 `5180`，由 `socat` 转发到对外 `5179`（本机开发保持默认 `5179` 直连，无需转发） |

Docker 中 `HYPIT_REPO=/opt/hypit`、`HYPIT_PROJECT=/projects/default` 已在 `docker/Dockerfile` 中写死，一般无需覆盖。

## 模型与服务配置

**默认配置不接入任何生成模型服务**（纯本地：HyperFrames 渲染 + 本地媒体处理）。纯字幕 / 动效 / 代码渲染的视频不需要模型服务，开箱即用。

需要 AI 生图 / 生视频 / 语音合成时，有两条路：

1. **HypiHub 托管网关（上游官方方案）**：Hypit 官方发行版中，所有生成模型（Seedance、Seedream、GPT Image、Nano Banana、Grok Imagine、MiniMax、ElevenLabs/FishAudio 语音、WhisperX 云端转写等）统一经由 `@hypit/provider-hypihub` 调用。启用方法：在 Runtime Profile（`/projects/default/hypit.runtime.json`）的 `endpoints` 中加回：

   ```json
   "credentials": { "file": { "use": "@hypit/credential-store-file", "config": { "path": "credentials" } } },
   "endpoints": { "hypihub.default": { "use": "@hypit/provider-hypihub",
     "config": { "baseUrl": "https://hypit.ai", "apiKey": { "store": "file", "key": "hypihub.oauth" }, "defaultConcurrency": 3 } }, ... }
   ```

   然后在工作台「模型与服务」页填入 API Key（凭据以文件形式存放在容器内 `credentials/` 目录，随 `hypit-home` 卷持久化），可按需调整总并发与每模型能力并发。
2. **自建直连 Provider（用你自己的各厂商 API Key，开发中）**：源码放在 `projects/default/packages/`（git 跟踪，`dist/` 不跟踪），按 `docs/superpowers/specs/2026-09-17-direct-providers-design.md` 实现，参考上游 `examples/provider-package/`。当前已接入 `provider-openai-image` 骨架（`openai.images` endpoint，绑定 `@hypit/gpt-image@1#gpt-image-2`）；`handler` 尚未实现真实调用逻辑。开发前先 `pnpm providers:setup && pnpm providers:build`。

本地渲染（HyperFrames）与本地媒体处理不需要额外配置，容器内已固定使用 `chromium-nosandbox` 包装脚本 + 软件渲染（`browserGpu: "software"`）。

## 已知限制

- **Apple Silicon 上软件渲染较慢**：容器内 Chromium 因 Docker 默认 seccomp 禁用户命名空间而无法用 GPU/沙箱加速，`browserGpu` 固定为 `software`，HyperFrames 本地渲染耗时会明显长于宿主机原生浏览器。
- **Studio 经 socat 转发**：`hypit studio` 只能监听 `127.0.0.1`，无法直接对容器外暴露；`workbench` 服务用 `socat` 把内部 `5180` 转发到对外 `5179`，多一跳网络代理，属预期行为而非 bug。
- **凭据 file store 为明文卷**：容器内没有 OS 级钥匙串，`@hypit/credential-store-file` 把 API Key 明文存放在 `hypit-home` 卷下的 `credentials/` 目录中，仅适合本机单人使用场景，不要把该卷同步到不受信任的位置。
- **单人 / 无鉴权**：Compose 只绑定 `127.0.0.1`，不做多用户或登录鉴权，不要直接暴露到公网。
- **前端能力范围收窄**：当前版本未实现 spec 中的三项前端能力——Build 产物画廊/内联预览、WhisperX 配置卡、Profile 保存前 diff 预览；后端产物下载接口（`GET /api/builds/:id/outputs/:name`）已就绪，留待后续迭代接入前端。
- **`docker compose restart` 会连带杀掉 workbench**：`workbench` 与 `runtime` 共享 PID 命名空间（`pid: "service:runtime"`），重启 runtime 容器会销毁该命名空间导致 workbench 以 137 退出。重启后用 `docker compose up -d` 把 workbench 拉回，或直接用 `docker compose down && docker compose up -d`。

## 验证状态

<!-- 以下状态在实现 Docker 化任务时通过实际执行验证，如后续环境变化请重新核实 -->

- `docker compose build && docker compose up -d` 已在 Apple Silicon + Docker Desktop（linux/arm64 容器）上实际构建并启动成功。
- `docker/smoke.sh` 对 `/api/health`、`/api/runtime/status`、`/api/doctor`、`/api/builds`、`/api/profile`、`/api/studio` 六个接口的探测已跑通。
- `hypit doctor --json` 中浏览器诊断项已确认走 `chromium-nosandbox` 路径；默认纯本地配置下 doctor `ok:true` 无 error。

如果你在其他环境（不同 CPU 架构、Docker 版本）上遇到构建失败，最常见原因是 apt 源瞬时 502（重试即可）或 `docker/docker-compose.yml` 中 `context` 路径与你的目录布局不一致——本仓库要求 `hypit-workbench` 与 `hypit` 是同级目录。
