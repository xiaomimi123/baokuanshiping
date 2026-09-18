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
    │   └── src/routes/         # runtime / builds / profile / auth / studio / templates / projects 七组路由
    ├── web/                    # 前端：Vite + React + TypeScript
    │   └── src/pages/          # 总览 / 创作 / 模型与服务 / 任务 / Studio 五个页面
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

### 创作页：从模板到成片

工作台内置「创作」页（`/create`），提供不写代码的三步向导：

1. **选模板**：卡片网格，选中一个模板作为起点，输入标题后即在 `projects/<slug>-<随机>/` 下建出一份该模板的独立拷贝（不影响上游 `examples/` 与其他项目）。
2. **放素材**：拖拽/点击上传文件到该项目的 `assets/uploads/`（可删除、可重传同名覆盖）；参考视频行内有「转写」按钮，把语音转成可复制文本，方便照着改台词。
3. **改内容并出片**：按模板声明的变量表单改文案/数字/替换素材，点「开始生成」发起一次 `hypit build`，自动跳转任务页并轮询该次 Build 状态；完成后内联预览产物（视频 `<video>`、图片 `<img>`，其余给下载链接）。

已建的项目在项目列表页可再次打开，回到②③继续改、重新出片；新建的项目目录就落在宿主机 `projects/<name>/`（Docker 场景经 `../projects` bind mount），可以直接用文件管理器/编辑器查看产物和源文件，不需要进容器。

四个内置模板及各自所需服务：

| 模板 | 说明 | 所需服务 |
| --- | --- | --- |
| 对话动画（`semantic-composition`） | 八秒纯项目组件绘制的聊天动画 | 无——不调用任何生成模型，开箱即可出片 |
| 双人播客（`podcast`） | 竖屏播客片段，含 AI 配音、生图与生成式插入镜头 | 视频生成（Seedance）+ 图片生成（GPT-Image）+ 语音转写对齐（WhisperX）+ 语音合成（FishAudio） |
| 球星梗榜单（`ranking-football`） | 主播吐槽式球星排位竖屏短视频 | 同上（Seedance / GPT-Image / WhisperX / FishAudio） |
| 街头采访（`interview`） | 路人街头采访问答梗视频 | 同上（Seedance / GPT-Image / WhisperX / FishAudio） |

模板卡片上「需先配置 X」的提示即缺失上表对应能力；点击可跳转「模型与服务」页配置（见下文）。素材上传单文件上限 **512MB**，只接受 `video/`、`audio/`、`image/` 大类的常见格式。转写功能依赖 WhisperX 转写 endpoint（目前只能走下文「HypiHub 托管网关」接入），未配置时点「转写」会提示先去模型页配置，不会报无关错误。

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
- **ffmpeg 单独从 Debian trixie 装，不用 bookworm 基础镜像自带的版本；这实质是一次有意的局部跨发行版升级**：`node:22-bookworm` 自带 ffmpeg 5.1.9 在本镜像（aarch64）实测有 AAC 编码时长舍入问题——用 `-c:a aac` 把一段精确 8 秒的静音音轨编码进 mp4 后，`ffprobe` 量出的时长变成 7.936s（少 3072 个采样），而 hypit 最终 mux 步骤对采样数做严格校验（容不下 1 个采样的误差），会导致**所有带音轨的 Build**（含创作页任意模板，哪怕是纯本地免模型的对话动画）在最后一步 100% 失败，报 `Final mux audio presentation span differs from TimelineAudio`。`docker/Dockerfile` 因此额外加了一条从 `deb.debian.org/debian trixie` 用 `-t trixie` 装 `ffmpeg` 的 `RUN`；但 `-t trixie` 只锁定 ffmpeg 这一个目标包，apt 依赖解析仍会按需连带把 `libavcodec61` 等依赖、以及 `libc6`/`base-files` 等基础包一并从 trixie 装或升级——镜像内 `cat /etc/debian_version` 会如实自报 `trixie/sid`（Debian 13），并非仍停留在 bookworm。这是为解决上述 ffmpeg bug 而接受的有意的部分跨发行版升级，装完即删掉 `/etc/apt/sources.list.d/trixie.list` 防止后续 `RUN` 层意外继续从 trixie 拉取其他包；trixie 的 ffmpeg 7.1.5 同一条命令量出精确的 8.000000s，问题已在上游修复。后续跟进项：评估直接切换到 `node:22-trixie` 基础镜像，避免这种"镜像标签与实际系统版本不一致"的维护负担。
- **Studio 经 socat 转发**：`hypit studio` 只能监听 `127.0.0.1`，无法直接对容器外暴露；`workbench` 服务用 `socat` 把内部 `5180` 转发到对外 `5179`，多一跳网络代理，属预期行为而非 bug。
- **凭据 file store 为明文卷**：容器内没有 OS 级钥匙串，`@hypit/credential-store-file` 把 API Key 明文存放在 `hypit-home` 卷下的 `credentials/` 目录中，仅适合本机单人使用场景，不要把该卷同步到不受信任的位置。
- **单人 / 无鉴权**：Compose 只绑定 `127.0.0.1`，不做多用户或登录鉴权，不要直接暴露到公网。
- **语音能力暂无直连 Provider**：本轮只做了生图 / 生视频三家（火山引擎、OpenAI 兼容、Gemini）的直连 Provider；语音合成（TTS）/ 转写目前只能走 HypiHub 托管网关（ElevenLabs/FishAudio、WhisperX），没有自建直连实现。
- **容器内改了 provider 源码要自己重新编译，entrypoint 不会自动重编译**：`docker/entrypoint-*.sh` 启动时只在 `/projects/default/packages/<pkg>` **缺失整个目录**或**缺失 `dist/`** 时，才从镜像内种子（`/opt/workbench-providers`）补一份源码+产物；如果你在容器里改了某个 provider 包的 `src/` 但没删/没建它自己的 `dist/`，entrypoint 不会重编也不会同步，跑的还是旧 `dist/`，源码和产物会悄悄不一致。改完源码后要自己重建：宿主机上 `pnpm providers:build`（`pnpm --filter '@workbench/provider-*' run build`），或容器内等效地对该包跑 `tsc -p tsconfig.json`。同理，如果手动删掉了某包的 `dist/` 想"重新触发种子同步"，补回来的也是**镜像构建时的旧版本 dist**，不是你改过的源码编译结果——想要新代码生效，必须自己跑一次 build，而不是依赖 entrypoint 的兜底同步。
- **前端能力范围收窄**：Build 产物内联预览（任务详情页 video/image 内联播放 + 下载）已实现（`GET /api/builds/:id/outputs` 拉产物清单 + 既有 `GET /api/builds/:id/outputs/:name` 下载）；仍未实现的是 WhisperX 配置卡、Profile 保存前 diff 预览，留待后续迭代。
- **`docker compose restart` 会连带杀掉 workbench**：`workbench` 与 `runtime` 共享 PID 命名空间（`pid: "service:runtime"`），重启 runtime 容器会销毁该命名空间导致 workbench 以 137 退出。重启后用 `docker compose up -d` 把 workbench 拉回，或直接用 `docker compose down && docker compose up -d`。
- **容器与宿主机各自维护 `@hypit` symlink**：`docker-compose.yml` 给两个服务的 `/projects/default/node_modules` 都加了匿名卷，让容器每次启动重建的 `@hypit/hypit`（指向镜像内 `/opt/hypit`）不会写穿到宿主机 bind mount、覆盖宿主机 `pnpm providers:setup` 建的 symlink（指向 `$HYPIT_REPO`）。代价是两边各自独立、互不同步：如果宿主机上直接跑 provider 包测试报找不到 `@hypit/hypit` 或 `@hypit/driver-node`，在仓库根目录跑一次 `pnpm providers:setup` 重建宿主机自己的 symlink 即可。
- **产物预览无 Range/206 支持**：`GET /api/builds/:id/outputs/:name` 每次请求都会重新跑一次 `hypit get` 把产物导出到临时文件再整份 `send`，不支持 `Range` 请求头/`206 Partial Content`，大视频在浏览器里无法拖动 seek（只能从头顺序播放），且每次打开预览都会触发一次完整的临时文件导出（额外磁盘 I/O 与耗时，产物越大越明显）。
- **方舟视频生成任务提交无幂等键**：`createVolcengineProvider` 的 `start()` 提交任务后若在 `requestTimeoutMs` 内没拿到响应（网络中断、超时等），本地会判定该次 `start` 失败并可能被上层重试；但方舟侧的任务可能已经创建成功并开始计费，重试会再次提交产生第二个任务。由于方舟"创建视频生成任务"接口未提供幂等键（如 `Idempotency-Key`）参数，直连 Provider 目前无法规避这种"远端已产生计费任务但本地未记录其 taskId、后续也不会被继续轮询"的重复提交风险。

## 验证状态

<!-- 以下状态在实现 Docker 化任务时通过实际执行验证，如后续环境变化请重新核实 -->

- `docker compose build && docker compose up -d` 已在 Apple Silicon + Docker Desktop（linux/arm64 容器）上实际构建并启动成功。
- `docker/smoke.sh` 对 `/api/health`、`/api/runtime/status`、`/api/doctor`、`/api/builds`、`/api/profile`、`/api/studio`、`/api/templates` 七个接口的探测已跑通。
- `hypit doctor --json` 中浏览器诊断项已确认走 `chromium-nosandbox` 路径；默认纯本地配置下 doctor `ok:true` 无 error。
- **创作页容器内端到端已实测跑通**：`POST /api/projects`（`semantic-composition` 模板）→ `PUT .../variables` 改文案 → `POST .../build` → 轮询 `GET /api/builds/:id?project=` 至 `complete`（对话动画模板全流程约 14 秒）→ `GET .../outputs` 拿到 `final.video`（`video/mp4`）→ `GET .../outputs/final.video?type=video/mp4` 下载，76501 字节非零、`content-type: video/mp4` 内联头正确、`ffprobe` 确认音视频轨都精确 8.000000s。

如果你在其他环境（不同 CPU 架构、Docker 版本）上遇到构建失败，最常见原因是 apt 源瞬时 502（重试即可）或 `docker/docker-compose.yml` 中 `context` 路径与你的目录布局不一致——本仓库要求 `hypit-workbench` 与 `hypit` 是同级目录。
