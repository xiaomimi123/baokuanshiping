# Hypit Workbench 设计（Docker 部署 + 前端工作台）

日期：2026-09-17
状态：待用户评审

## 1. 目标

1. 把 Hypit（本地源码部署于 `../hypit`）容器化：`docker compose up` 一键在本机跑起 Hypit Runtime（含本地渲染）。
2. 提供一个 Web 工作台（Workbench），风格仿 hypit.ai：
   - **模型与服务配置**：可视化管理 Runtime Profile 的 endpoints——HypiHub 网关（生图/视频/语音模型统一入口）的 API Key、并发、每模型能力并发；本地渲染 / 本地媒体 / WhisperX 三个 Provider 的参数；测试连通性。
   - **任务面板**：Build 列表、实时状态、日志、产物预览与下载。
   - **门户首页**：Runtime 健康状态、一键跳转官方 Studio。

## 2. 非目标（YAGNI）

- 不做各模型厂商（火山引擎 / OpenAI / ElevenLabs…）的**直连** Provider——官方发行版中所有生成模型统一经由 `@hypit/provider-hypihub`，直连需自建 Provider 包，另立项目。
- 不改上游 `hypit` 仓库任何代码（保持可 `git pull` 升级）。
- 不重造视频编辑器——编辑仍用官方 Studio（工作台仅代理/跳转）。
- 不做多用户 / 鉴权（本机单人使用；compose 只绑定 127.0.0.1）。

## 3. 事实依据（来自上游仓库调研）

- Runtime Profile 唯一 schema：`packages/runtime-local/src/config.ts`，格式 `hypit.runtime-local@1`，顶层键仅 `format | dataRoot | worker | credentials | endpoints | bindings`，多余键报错。
- 所有生成模型（Seedance、Seedream、GPT Image、Nano Banana、Grok Imagine、MiniMax H3、ElevenLabs/FishAudio/Mimo 语音、WhisperX 云端）都由 `@hypit/provider-hypihub` 执行；config 关键字段：`baseUrl`、`apiKey`（凭据引用 `{store,key}`）、`defaultConcurrency`、`capabilityConcurrency`（如 `{"seedance-2-mini":2}`）、超时组。
- 本地渲染 `@hypit/provider-hyperframes-local`：Linux 容器内**必须**用 `config.chromePath`（如 `/usr/bin/chromium`）+ `browserGpu:"software"`；环境变量 `HYPERFRAMES_BROWSER_PATH` 被该 Provider 明确忽略；`chromePath` 不能与 `browserVersion` 同时出现。
- 凭据：容器内无 OS 钥匙串 → 用 `@hypit/credential-store-file`（每 key 一个 JSON 文件，目录 owner-private，挂载卷持久化）。非交互登录：`hypit auth login <endpoint> --from <file>`。
- CLI 全命令支持 `--json` 稳定机器输出（`hypit.cli-builds@1`、`hypit.cli-status@1`、`hypit.cli-doctor@1`、`hypit.cli-runtime-status@1`、`hypit.cli-auth-status@1`、`hypit.cli-pricing@1` 等）——Workbench 后端不解析人类文本。
- Studio：`hypit studio --run <svrun> --port <n>`，默认 5179，**只监听 127.0.0.1，host 不可配** → 容器内用 socat 转发到 0.0.0.0。
- 上游无任何 Docker 配置；CI 用 ubuntu + apt ffmpeg，浏览器渲染测试不在 CI 跑。

## 4. 总体架构

```
hpyit爆款视频复刻/
├── hypit/                  # 上游源码（不改动）
├── hypit-workbench/        # 本项目（新 git 仓库）
│   ├── docker/
│   │   ├── Dockerfile          # 单镜像：node22 + chromium + ffmpeg + python/uv + hypit 源码
│   │   ├── docker-compose.yml
│   │   ├── entrypoint-runtime.sh
│   │   └── runtime.docker.json # 容器版 Runtime Profile 模板
│   ├── server/             # Workbench 后端（Fastify，TypeScript）
│   ├── web/                # Workbench 前端（Vite + React + TS）
│   └── docs/
└── projects/               # 视频项目目录（卷挂载，宿主机可见）
```

### 4.1 Docker（compose 两个服务，共享一个镜像）

| 服务 | 职责 | 端口(仅 127.0.0.1) |
| --- | --- | --- |
| `runtime` | `hypit runtime up` 起 Worker；按需以子进程起 Studio + socat 转发 | 5179 (Studio) |
| `workbench` | Fastify 后端 + 静态前端；通过共享卷调 hypit CLI | 8090 |

镜像：`node:22-bookworm` + `chromium ffmpeg python3 uv socat`；构建时 `corepack pnpm install --frozen-lockfile`（上游源码 COPY 进镜像；开发期也可卷挂载源码覆盖）。

卷：
- `../projects → /projects`（视频项目，宿主机直接可见产出）
- `hypit-state`（named volume → 容器 Host state root：Managed Programs、Results 索引、credentials 目录）
- `chromium` 用系统包，无需浏览器缓存卷

容器版 Runtime Profile（`runtime.docker.json`，首次启动复制到 /projects 并 `runtime use`）：

```json
{
  "format": "hypit.runtime-local@1",
  "dataRoot": ".hypit/runtimes/local",
  "credentials": {
    "file": { "use": "@hypit/credential-store-file", "config": { "path": "credentials" } }
  },
  "endpoints": {
    "hypihub.default": {
      "use": "@hypit/provider-hypihub",
      "config": { "baseUrl": "https://hypit.ai",
                  "apiKey": { "store": "file", "key": "hypihub.oauth" },
                  "defaultConcurrency": 3 }
    },
    "media.local": { "use": "@hypit/provider-media-local" },
    "hyperframes.local": {
      "use": "@hypit/provider-hyperframes-local",
      "config": { "chromePath": "/usr/bin/chromium", "browserGpu": "software",
                  "workers": 2, "maxWorkers": 4, "defaultConcurrency": 1 }
    }
  }
}
```

已知限制（写进 README）：Apple Silicon 上容器是 linux/arm64，渲染走软件 GPU，速度低于宿主机原生跑 `hypit runtime up`；两种方式可并存（状态目录相互独立）。

### 4.2 Workbench 后端（server/）

Fastify + TypeScript，约 6 个路由模块，全部是对既有机制的薄封装：

- `GET /api/health`、`GET /api/runtime/status` → `hypit runtime status --json`
- `POST /api/runtime/up|down` → 对应 CLI
- `GET /api/doctor` → `hypit doctor --json`（可带 `?endpoint=`）
- `GET/PUT /api/profile` → 读/写 Runtime Profile JSON；PUT 前用上游 `parseLocalRuntimeProfile` 做校验（直接 import 上游包，保证与 CLI 同一套校验）
- `GET /api/auth/:endpoint` → `auth status --json`；`POST /api/auth/:endpoint` → 把前端提交的 key 写临时文件后 `auth login --from`，用后即删
- `GET /api/builds`、`GET /api/builds/:id`、`GET /api/builds/:id/logs`、`GET /api/builds/:id/outputs/:name`（流式返回产物）→ 对应 CLI `--json` / `get`
- `POST /api/studio` → 以指定 `.svrun` 启动 Studio 子进程（幂等：已运行则返回现有地址）

子进程执行统一走一个 `runHypit(args): Promise<Json>` 工具：固定 cwd 为项目目录、注入 `--json`、按 `format` 判别式解析、`hypit.cli-error@1` 转为结构化错误。

### 4.3 Workbench 前端（web/）

Vite + React + TypeScript，无重型 UI 框架（手写样式系统即可达成 hypit.ai 风格）。

页面（4 个路由）：

1. **首页 / 仪表盘**：Runtime 状态卡（Worker/Programs/活动 Build 数）、doctor 诊断摘要、快捷入口（打开 Studio、去配置）。
2. **模型与服务**：endpoint 卡片网格。
   - HypiHub 卡：连接状态（auth status）、填 API Key（→ auth login）、`defaultConcurrency`、`capabilityConcurrency` 按模型（Seedance 2 / 2.5 / Mini、Seedream 5 Lite、GPT Image 2、Nano Banana、Grok Imagine、MiniMax H3、语音 5 种、转写）逐项设置、超时高级项折叠。
   - 本地渲染卡：workers / maxWorkers / 并发 / browserGpu / chromePath（容器内只读展示）。
   - WhisperX 卡（默认停用，可一键添加 endpoint + binding）：model/device/compute/语言。
   - 保存 = PUT profile（前端 diff 预览 → 确认写入）；每卡"测试" = doctor --endpoint。
3. **任务面板**：Build 列表（分页游标 `next`/`--before`）、详情抽屉（work/result/operations 进度、attention、失败原因、日志尾部）、产物画廊（图/视频内联预览、下载）。进行中任务 3s 轮询 status。
4. **Studio**：选择 /projects 下的项目与 `.svrun` → 启动并跳转 5179。

视觉规范（取自官方 logo 与官网）：白底 `#FFFFFF`；文字近黑 `#010101`；品牌粉主色 `#E83F5F`，渐变族 `#E94765 → #F1738C → #F6A9BD` 用于强调/进度条/logo 区；无衬线系统字体栈；大标题 + 宽松留白 + 细边框卡片（1px `#EAEAEA`，8-12px 圆角）；界面语言中文。

## 5. 错误处理

- CLI 非零退出/`hypit.cli-error@1` → 后端统一转 `{ code, message, detail }`，前端 toast + 卡片内错误态。
- Profile 写入失败（schema 校验不过）→ 不落盘，返回具体字段错误。
- 凭据只经内存与临时文件（0600，用后删除），不落日志。
- Runtime 未就绪时任务面板降级为只读 Results（`builds` 命令无需 Runtime）。

## 6. 测试

- 后端：vitest 单测 `runHypit` 解析、profile 读写校验（用上游 parse 函数的真实错误样例）、auth 临时文件清理。
- 集成：一个冒烟脚本在容器里跑 `doctor --json` + 起 workbench 后 curl 各只读 API。
- 前端：手动验收清单（配置保存往返、任务列表、Studio 跳转）；不做 E2E。

## 7. 实施顺序

1. Docker 镜像 + compose，容器内 `runtime up` 跑通、doctor 干净
2. server/：runHypit + 只读 API（status/doctor/builds）
3. server/：profile 读写 + auth
4. web/：设计系统 + 首页 + 模型与服务页
5. web/：任务面板 + Studio 启动
6. 冒烟测试 + README（安装/启动/常见问题）
