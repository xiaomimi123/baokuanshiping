# 直连模型 Provider 设计（火山引擎 / OpenAI 兼容 / Gemini）

日期：2026-09-17
状态：用户已批准方向；契约调研见 `../research/2026-09-17-provider-contract.md`

## 1. 目标

不经 HypiHub，用用户自己的 API Key 直连三家模型服务，为 Hypit 提供生视频/生图能力；在工作台「模型与服务」页完成全部配置（baseUrl、API Key、线上模型 ID、测试连通）。

## 2. 非目标（YAGNI）

- 语音直连（ElevenLabs/FishAudio/Mimo 5 个语音能力）——用户未提需求。
- 转写直连——上游已有本地 WhisperX Provider。
- 实时定价读取（readPricing）——只挂定价页链接。
- 上游模型包未声明的模型（如 Ark 上的其它模型）——只承接上游 4 个模型包已声明的 8 个 capability。

## 3. 包与能力划分

三个包，源码放 `projects/default/packages/`（上游"项目本地包"约定路径，git 跟踪源码，`dist/` 构建产物不跟踪）：

| 包（name = use） | capability（binding key） | 生命周期 | 对接 API |
| --- | --- | --- | --- |
| `@workbench/provider-volcengine` | `@hypit/seedance@1#seedance-2` / `#seedance-2-fast` / `#seedance-2-mini` / `#seedance-2.5` | asynchronous | 方舟 `POST {base}/api/v3/contents/generations/tasks` 创建；`GET .../tasks/{id}` 轮询；产出 `content.video_url` 下载 |
| 同上 | `@hypit/seedream@1#seedream-5-lite` | immediate | 方舟 `POST {base}/api/v3/images/generations`（`response_format:"b64_json"`） |
| `@workbench/provider-openai-image` | `@hypit/gpt-image@1#gpt-image-2` | immediate | `POST {base}/v1/images/generations`；有输入图时 `POST {base}/v1/images/edits`（multipart）；`b64_json` |
| `@workbench/provider-gemini-image` | `@hypit/nano-banana@1#nano-banana-2` / `#nano-banana-pro` | immediate | `POST {base}/v1beta/models/{model}:generateContent`（header `x-goog-api-key`），响应 `candidates[].content.parts[].inlineData` base64 |

## 4. Endpoint 配置 schema（runtimeConfigExact 白名单）

统一原则：**线上模型 ID 全部可配**（厂商模型 ID 随时间变化），默认值尽量给真实可用的；给不出的（方舟 Seedance 2.x 的模型 ID 因账号开通而异）默认空字符串，运行时报清晰中文错误提示"到方舟控制台确认模型 ID 并填入配置"。

```jsonc
// volcengine.default
{ "use": "@workbench/provider-volcengine",
  "config": {
    "baseUrl": "https://ark.cn-beijing.volces.com",   // 默认值
    "apiKey": { "store": "file", "key": "volcengine.ark" },
    "modelMap": {                                      // capability → 方舟模型 ID
      "seedance-2": "", "seedance-2-fast": "", "seedance-2-mini": "", "seedance-2.5": "",
      "seedream-5-lite": ""
    },
    "defaultConcurrency": 2, "pollIntervalMs": 8000, "requestTimeoutMs": 120000
  } }
// openai.images
{ "use": "@workbench/provider-openai-image",
  "config": { "baseUrl": "https://api.openai.com",     // 换中转站只改这里
              "apiKey": { "store": "file", "key": "openai.images" },
              "wireModel": "gpt-image-1",
              "defaultConcurrency": 2, "requestTimeoutMs": 180000 } }
// gemini.images
{ "use": "@workbench/provider-gemini-image",
  "config": { "baseUrl": "https://generativelanguage.googleapis.com",
              "apiKey": { "store": "file", "key": "gemini.images" },
              "modelMap": { "nano-banana-2": "gemini-2.5-flash-image",
                            "nano-banana-pro": "gemini-3-pro-image-preview" },
              "defaultConcurrency": 2, "requestTimeoutMs": 180000 } }
```

`credentials`（Profile 顶层）恢复 file store：`"file": { "use": "@hypit/credential-store-file", "config": { "path": "credentials" } }`。
`bindings`：8 个 capability 各一条，指向上述 3 个 instance。

## 5. Port 映射与支持面（宁窄勿错：承接不了的组合在 `supports()` 给出明确 reason 拒绝）

- **Seedance**：支持 prompt、firstFrame、lastFrame、referenceImage（图片以 `data:` base64 URL 进 content 数组，role 分别为 first_frame/last_frame/reference_image）、resolution、aspectRatio、duration、generateAudio（映射为方舟文本参数后缀 `--resolution/--ratio/--duration/--audio`）。**不支持**：referenceVideo、referenceAudio、webSearch → unsupported。
- **Seedream**：prompt、aspectRatio+quality（映射为方舟 `size`：basic→1K、high→2K、ultra→4K 档，按 aspectRatio 换算具体像素或直接传档位）、outputFormat、images（i2i，base64）。nsfwCheck 忽略（不影响请求），`watermark:false` 常量。
- **GPT Image**：prompt、background、images（→ edits multipart）。aspectRatio 仅接受可映射到 1024x1024 / 1536x1024 / 1024x1536 的（1:1、3:2、2:3；其余 unsupported）；resolution 仅 1K。
- **Nano Banana**：prompt、images、aspectRatio（透传 Gemini `imageConfig.aspectRatio`，支持 Gemini 列表内的比例）、resolution（仅 pro 模型支持 1K/2K/4K → `imageSize`；2 号模型只接受 1K）。outputFormat 忽略（按返回 mime 交付）。

## 6. 产物与媒体

- 输出：全部 `context.resources.put(bytes, mediaType)` → `sealGeneratedImageSet/VideoSet` → `canonicalize` inline 返回。Seedance 的 `video_url` 是签名 URL，下载时不带 Authorization。
- 输入媒体：`resources.get(artifact.resource)` 读字节 → 图片转 base64（data URL 或 API 各自的字段）。不做上传中转。

## 7. SDK 解析与构建（Task 1 骨架验证的核心风险）

- `projects/default/package.json`（`{"name":"default-video-project","private":true,"type":"module"}`）确立项目边界。
- Provider 包内 `import "@hypit/hypit/endpoint-kit"` 的解析：`projects/default/node_modules/@hypit/hypit` 做 **symlink 指向上游仓库根**（上游 exports 指 TS 源码，宿主 worker 在 tsx 下运行可直接消费）。容器内 entrypoint 每次启动 `ln -sfn /opt/hypit ...`；宿主机开发由 `scripts/setup-providers.sh` 建到 `../hypit` 的相对链接。若 Task 1 验证发现 tsx 源码路径走不通，回退方案：在上游 checkout 里跑一次 `npm run build:public-types` 并将 provider 编译目标改为引用 d.ts + 运行时仍走源码（具体以骨架实测为准，允许实现阶段调整并记录）。
- 构建：每包 `tsconfig.json`（NodeNext，src→dist），根 `package.json` 增加 `providers:build` 脚本逐包 tsc；`pnpm-workspace.yaml` 加入 `projects/default/packages/*`；devDependencies 仅 `typescript`（types 经 symlink 的上游源码获得）。
- `.gitignore` 调整：`/projects/*` 但保留 `!/projects/default/`、忽略其中 `.hypit/`、`node_modules/`、`packages/*/dist/`。
- Docker：Dockerfile 构建阶段编译 providers；entrypoint 建 symlink；smoke 增加 doctor --endpoint 断言。

## 8. 前端（Models 页）

把"生成模型服务未接入"占位卡替换为三张厂商卡（火山引擎 / OpenAI 兼容 / Gemini），每张：

- 连接状态徽标（auth status per endpoint，接口已通用）
- API Key 输入（password，POST /api/auth/:endpoint，保存后清空）
- baseUrl 输入（中转站用户改 OpenAI 卡的 baseUrl）
- 模型 ID 输入（volcengine 5 项 modelMap、openai 1 项 wireModel、gemini 2 项 modelMap）
- 「测试」按钮 = GET /api/doctor?endpoint=
- 保存 = 既有 PUT /api/profile（上游校验）

Profile 中不存在对应 endpoint 时卡片显示"未启用"+「一键启用」（前端往 profile 写入 §4 的默认配置块 + 对应 bindings，再 PUT）。

## 9. 测试

- 每个 provider 包：注入假 `fetch` 的生命周期单测（volcengine 视频走 start→poll(pending)→poll(ready)→collect；三家 immediate 走 handler；断言请求体字段、幂等键、unsupported reason、错误消息不含 key/签名 URL），模式照抄 `examples/provider-package/.../test/provider.test.ts`，用 `@hypit/driver-node` 的 EndpointRegistry + MemoryResourceStore。
- 集成验收（不花钱）：容器内 `hypit doctor --endpoint <各实例>` 通过、`auth status` 显示各 slot、workbench 页面三卡可保存往返。
- 真实调用不在 CI/验收范围（花钱且需用户 Key）；README 写明首次真实出片的自测步骤。

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| symlink 方案解析不通（loader 不走 Node 常规解析 / 非 tsx 宿主） | Task 1 骨架最先验证，走不通再按 §7 回退方案调整并记录裁决 |
| 厂商 API 字段与本文有出入 | 实现前逐家 WebFetch 官方文档核对；modelMap/wireModel 可配置兜底 |
| 方舟模型 ID 因账号而异 | 默认空 + 明确报错文案 + UI 必填提示 |
| 中转站兼容性参差 | OpenAI 卡只承诺标准 images API；README 注明 |
