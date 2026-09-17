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
            ├── provider-openai-image/  # 直连 OpenAI 兼容生图 Provider（gpt-image-2，immediate）
            ├── provider-gemini-image/  # 直连 Gemini 生图 Provider（nano-banana-2/pro，immediate）
            └── provider-volcengine/    # 直连火山引擎方舟 Provider（Seedance 异步 + Seedream immediate）
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

需要 AI 生图 / 生视频时，默认路径是**直连各厂商自己的 API Key**（火山引擎方舟 / OpenAI 兼容 / Gemini），源码入库在 `projects/default/packages/`（git 跟踪，`dist/` 不跟踪），按 `docs/superpowers/specs/2026-09-17-direct-providers-design.md` 实现，参考上游 `examples/provider-package/`。Docker 镜像已内置这三个 Provider 包的编译产物作种子（容器首次启动时同步到 `/projects/default/packages`），`docker/runtime.docker.json` 模板里三个 endpoint + 8 条 binding 已经就绪，只缺 API Key。

已接入三个 Provider 包，对应工作台 Models 页的三张卡：

- **火山引擎方舟卡**（`provider-volcengine` → `volcengine.default` endpoint）：绑定 `@hypit/seedance@1` 的 4 个能力（asynchronous，方舟异步任务：提交 → 轮询 → 下载视频）+ `@hypit/seedream@1#seedream-5-lite`（immediate）。填写项：
  - **API Key**：方舟控制台的 API Key（火山引擎控制台 → 方舟大模型服务 → API Key 管理）。
  - **baseUrl**：默认 `https://ark.cn-beijing.volces.com`，一般不需要改（除非用了其他 region 的接入点）。
  - **模型 ID（5 项 modelMap）**：Seedance/Seedream 的具体模型 ID **因账号开通情况而异**，默认是空字符串，必须自己去方舟控制台确认后填入——路径：方舟控制台 → 模型广场（或「我的推理接入点」）→ 找到已开通的 Seedance / Seedream 模型 → 复制其 Model ID（不是模型名称，通常形如 `doubao-seedance-1-0-...` 之类的版本化 ID）。留空的能力调用时会报中文错误，提示去控制台确认。
- **OpenAI 兼容卡**（`provider-openai-image` → `openai.images` endpoint）：绑定 `@hypit/gpt-image@1#gpt-image-2`（immediate，`images` API）。填写项：
  - **API Key**：OpenAI 平台 Key，或中转站签发的 Key。
  - **baseUrl**：默认 `https://api.openai.com`；**接中转站只改这一项**，填中转站的 base URL（不含路径后缀，Provider 内部会拼接标准 `images`/`edits` 端点路径）。Provider 只承诺兼容 OpenAI 官方 `images` API 的请求/响应形状，中转站若做了非标准改造（字段增删、鉴权方式不同）不保证可用，出问题先用「测试」按钮跑 `doctor` 排查。
  - **模型 ID（wireModel）**：默认 `gpt-image-1`；中转站可能用别的模型名代理同一能力，按中转站文档改。
- **Gemini 卡**（`provider-gemini-image` → `gemini.images` endpoint）：绑定 `@hypit/nano-banana@1#nano-banana-2` / `#nano-banana-pro`（immediate）。填写项：
  - **API Key**：Google AI Studio / Gemini API Key。
  - **baseUrl**：默认 `https://generativelanguage.googleapis.com`。
  - **模型 ID（2 项 modelMap）**：默认 `gemini-2.5-flash-image` / `gemini-3-pro-image-preview`，一般不需要改，Google 更新模型代号时在此改即可。
  - **联调提示**：Provider 走的是 Gemini 经典的 `generateContent` 契约（`contents`/`parts` 结构）。Google 官方文档目前把首页流量导向新的 Interactions API，但 `generateContent` 端点本身当前仍在服务；**如果真实调用返回 404**，大概率是 Google 那边接口迁移影响到了具体模型/版本的可用性，先用「测试」按钮的 `doctor` 排查，并对照 Gemini 官方最新文档确认 `generateContent` 端点路径与模型名是否变化——这是本 Provider 相对官方文档漂移风险最高的一环。

三者的 `apiKey` 均需配置后才能实际出片。可直接手改 Runtime Profile，也可在工作台「模型与服务」页操作：三张厂商卡按需「启用」（一键写入默认配置块 + 绑定），随后填 API Key（保存后不回显）、baseUrl、模型 ID，「测试」按钮调用 `doctor` 校验连通性。开发前先 `pnpm providers:setup && pnpm providers:build`；Docker 环境不需要这一步，镜像构建期已编译好。

首次真实出片前的自测步骤：填好某张卡的 Key 和模型 ID 后先点「测试」确认 `doctor` 无 error，再在具体项目里发起一次最小化的生成请求（例如 Seedream 单图 immediate 调用），确认产物能正常下载和预览，再放心跑批量任务。

> **附注：HypiHub 托管网关（上游官方方案）**。如果你更想用 Hypit 官方托管网关而不是自己接各厂商 Key，Hypit 官方发行版支持所有生成模型（Seedance、Seedream、GPT Image、Nano Banana、Grok Imagine、MiniMax、ElevenLabs/FishAudio 语音、WhisperX 云端转写等）统一经由 `@hypit/provider-hypihub` 调用。启用方法：在 Runtime Profile（`/projects/default/hypit.runtime.json`）的 `endpoints` 中加回：
>
> ```json
> "credentials": { "file": { "use": "@hypit/credential-store-file", "config": { "path": "credentials" } } },
> "endpoints": { "hypihub.default": { "use": "@hypit/provider-hypihub",
>   "config": { "baseUrl": "https://hypit.ai", "apiKey": { "store": "file", "key": "hypihub.oauth" }, "defaultConcurrency": 3 } }, ... }
> ```
>
> 然后在工作台「模型与服务」页填入 API Key（凭据以文件形式存放在容器内 `credentials/` 目录，随 `hypit-home` 卷持久化）。HypiHub 和直连 Provider 可以同时配置，按 endpoint/binding 各自独立。

本地渲染（HyperFrames）与本地媒体处理不需要额外配置，容器内已固定使用 `chromium-nosandbox` 包装脚本 + 软件渲染（`browserGpu: "software"`）。

## 已知限制

- **Apple Silicon 上软件渲染较慢**：容器内 Chromium 因 Docker 默认 seccomp 禁用户命名空间而无法用 GPU/沙箱加速，`browserGpu` 固定为 `software`，HyperFrames 本地渲染耗时会明显长于宿主机原生浏览器。
- **Studio 经 socat 转发**：`hypit studio` 只能监听 `127.0.0.1`，无法直接对容器外暴露；`workbench` 服务用 `socat` 把内部 `5180` 转发到对外 `5179`，多一跳网络代理，属预期行为而非 bug。
- **凭据 file store 为明文卷**：容器内没有 OS 级钥匙串，`@hypit/credential-store-file` 把 API Key 明文存放在 `hypit-home` 卷下的 `credentials/` 目录中，仅适合本机单人使用场景，不要把该卷同步到不受信任的位置。
- **单人 / 无鉴权**：Compose 只绑定 `127.0.0.1`，不做多用户或登录鉴权，不要直接暴露到公网。
- **语音能力暂无直连 Provider**：本轮只做了生图 / 生视频三家（火山引擎、OpenAI 兼容、Gemini）的直连 Provider；语音合成（TTS）/ 转写目前只能走 HypiHub 托管网关（ElevenLabs/FishAudio、WhisperX），没有自建直连实现。
- **前端能力范围收窄**：当前版本未实现 spec 中的三项前端能力——Build 产物画廊/内联预览、WhisperX 配置卡、Profile 保存前 diff 预览；后端产物下载接口（`GET /api/builds/:id/outputs/:name`）已就绪，留待后续迭代接入前端。
- **`docker compose restart` 会连带杀掉 workbench**：`workbench` 与 `runtime` 共享 PID 命名空间（`pid: "service:runtime"`），重启 runtime 容器会销毁该命名空间导致 workbench 以 137 退出。重启后用 `docker compose up -d` 把 workbench 拉回，或直接用 `docker compose down && docker compose up -d`。

## 验证状态

<!-- 以下状态在实现 Docker 化任务时通过实际执行验证，如后续环境变化请重新核实 -->

- `docker compose build && docker compose up -d` 已在 Apple Silicon + Docker Desktop（linux/arm64 容器）上实际构建并启动成功。
- `docker/smoke.sh` 对 `/api/health`、`/api/runtime/status`、`/api/doctor`、`/api/builds`、`/api/profile`、`/api/studio` 六个接口的探测已跑通。
- `hypit doctor --json` 中浏览器诊断项已确认走 `chromium-nosandbox` 路径；默认纯本地配置下 doctor `ok:true` 无 error。

如果你在其他环境（不同 CPU 架构、Docker 版本）上遇到构建失败，最常见原因是 apt 源瞬时 502（重试即可）或 `docker/docker-compose.yml` 中 `context` 路径与你的目录布局不一致——本仓库要求 `hypit-workbench` 与 `hypit` 是同级目录。
