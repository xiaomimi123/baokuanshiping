# 直连模型 Provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个直连 Provider 包（火山引擎 Seedance/Seedream、OpenAI 兼容 GPT Image、Gemini Nano Banana）+ 工作台前端配置卡，替代 HypiHub。

**Architecture:** 按上游"项目本地包"契约实现（`defineEndpointPackage` + activation facet），源码在 `projects/default/packages/`，`@hypit/hypit` SDK 通过 node_modules symlink 指向上游源码 checkout。前端复用既有 profile/auth/doctor API。

**Tech Stack:** TypeScript (NodeNext, tsc)、上游 `@hypit/hypit` SDK（endpoint-kit/runtime-kit/generation）、vitest + 假 fetch、既有 React 前端。

**Spec:** `docs/superpowers/specs/2026-09-17-direct-providers-design.md`
**必读参考:** `docs/superpowers/research/2026-09-17-provider-contract.md`（上游契约调研，含全部文件行号索引）；上游示例 `$HYPIT_REPO/examples/provider-package/packages/provider-images/`（新 Provider 的模板，照抄其结构与测试模式）。

## Global Constraints

- `$HYPIT_REPO` = `/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit`（只读，绝不修改）；`$WB` = `/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit-workbench`。
- Node 22：命令前缀 `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`。
- 提交信息 `feat:`/`fix:` 前缀；**不加任何 Co-Authored-By / Claude 署名**（用户明确要求）。
- 包名与 `use` 必须一致：`@workbench/provider-volcengine` / `@workbench/provider-openai-image` / `@workbench/provider-gemini-image`；instance 名：`volcengine.default` / `openai.images` / `gemini.images`。
- capability key 逐字（8 个）：`@hypit/seedance@1#seedance-2`、`#seedance-2-fast`、`#seedance-2-mini`、`#seedance-2.5`；`@hypit/seedream@1#seedream-5-lite`；`@hypit/gpt-image@1#gpt-image-2`；`@hypit/nano-banana@1#nano-banana-2`、`#nano-banana-pro`。
- 错误消息不得包含 API Key 或带签名参数的 URL（`replace(/https?:\/\/\S+/g, "[redacted-url]")`）；凭据 slot 统一叫 `apiKey`。
- `supports()` 拒绝时 reason 非空中文；config 解析用 `runtimeConfigExact` 白名单（spec §4 的键集合）。
- 每个 Provider 的 `pricing: { kind: "page", url }`：volcengine `https://www.volcengine.com/pricing`；openai `https://platform.openai.com/docs/pricing`；gemini `https://ai.google.dev/gemini-api/docs/pricing`。
- 前端界面中文；只用既有设计系统类。

## File Structure

```
projects/default/
├── package.json                          # Task 1
├── packages/
│   ├── provider-openai-image/            # Task 1 骨架 → Task 2 完整
│   ├── provider-gemini-image/            # Task 3
│   └── provider-volcengine/              # Task 4
│       ├── package.json  tsconfig.json
│       ├── src/{activation.ts, provider.ts}
│       └── test/provider.test.ts
scripts/setup-providers.sh                # Task 1（symlink + build）
web/src/pages/Models.tsx                  # Task 6 改
docker/{Dockerfile, entrypoint-*.sh, runtime.docker.json, smoke.sh}  # Task 7 改
```

---

### Task 1: 走通骨架（项目化 + SDK 解析 + 最小 Provider 端到端）

**目的：先验证最大技术风险**——项目本地包能被 Runtime 找到、包内 `import "@hypit/hypit/endpoint-kit"` 能解析、`auth login` 认识 slot、doctor 通过。**本任务的 Provider 是 openai-image 的可运行骨架**（结构完整，handler 暂 `throw new Error("尚未实现")`），Task 2 补全逻辑。

**Files:**
- Create: `projects/default/package.json`, `scripts/setup-providers.sh`, `projects/default/packages/provider-openai-image/{package.json,tsconfig.json,src/activation.ts,src/provider.ts}`
- Modify: `.gitignore`, 根 `package.json`（scripts）, `pnpm-workspace.yaml`, `projects/default/hypit.runtime.json`（宿主机开发实例；容器模板在 Task 7 改）

**Interfaces produced:** `createOpenAiImageProvider(options: { instance; pool; baseUrl; apiKey: CredentialRef; wireModel: string; concurrency?: number; requestTimeoutMs?: number; fetch?: typeof fetch })` → `EndpointPackage`；activation 读 config 白名单 `["baseUrl","apiKey","wireModel","defaultConcurrency","requestTimeoutMs"]`。

- [ ] **Step 1: 项目化与 gitignore**

`projects/default/package.json`:
```json
{ "name": "default-video-project", "private": true, "type": "module" }
```

`.gitignore` 中把 `/projects/` 一行替换为：
```
/projects/*
!/projects/default/
/projects/default/*
!/projects/default/package.json
!/projects/default/packages/
projects/default/packages/*/dist/
projects/default/packages/*/node_modules/
```

`pnpm-workspace.yaml` packages 增加一行 `- projects/default/packages/*`。

根 `package.json` scripts 增加：
```json
"providers:setup": "bash scripts/setup-providers.sh",
"providers:build": "pnpm --filter '@workbench/provider-*' run build"
```

- [ ] **Step 2: setup 脚本（symlink SDK）**

`scripts/setup-providers.sh`:
```bash
#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
hypit="${HYPIT_REPO:-$here/../hypit}"
mkdir -p "$here/projects/default/node_modules/@hypit"
ln -sfn "$hypit" "$here/projects/default/node_modules/@hypit/hypit"
echo "linked @hypit/hypit -> $hypit"
```

- [ ] **Step 3: Provider 骨架**

`projects/default/packages/provider-openai-image/package.json`:
```json
{
  "name": "@workbench/provider-openai-image",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "hypit": { "activation": "./dist/activation.js" },
  "exports": { ".": "./dist/provider.js" },
  "files": ["dist"],
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.9.0", "vitest": "^3.0.0" }
}
```

`tsconfig.json`：照抄 `$HYPIT_REPO/examples/provider-package/packages/provider-images/tsconfig.json`（NodeNext、rootDir src、outDir dist、strict）。

`src/provider.ts` 骨架（结构照上游示例 provider.ts，capability 换成 gpt-image；handler 暂抛错）：
```ts
import { defineEndpointPackage } from "@hypit/hypit/endpoint-kit";
import type { CredentialRef, EndpointRequest } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-openai-image", version: "1" } as const;
export const capability = { module: { name: "@hypit/gpt-image", version: "1" }, name: "gpt-image-2" } as const;

export type CreateOpenAiImageProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  wireModel: string; concurrency?: number; requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createOpenAiImageProvider(options: CreateOpenAiImageProviderOptions) {
  return defineEndpointPackage({
    module: providerModule, facet: "images",
    instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "OpenAI 兼容服务 API Key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 2 } },
    pricing: { kind: "page", url: "https://platform.openai.com/docs/pricing" },
    capabilities: [{
      capability, returns: generationTypes.imageSet, lifecycle: "immediate",
      supports: (_request: EndpointRequest) => ({ status: "supported" as const }),
      handler: async () => { throw new Error("OpenAI Image Provider 尚未实现（Task 2）"); },
    }],
  });
}
```

`src/activation.ts`（模式照上游示例 activation.ts，白名单换成本包的）:
```ts
import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createOpenAiImageProvider, providerModule } from "./provider.js";

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "OpenAI image service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "wireModel", "defaultConcurrency", "requestTimeoutMs"], "OpenAI image service");
      const baseUrl = runtimeConfigString(config.baseUrl, "baseUrl") ?? "https://api.openai.com";
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "apiKey");
      const wireModel = runtimeConfigString(config.wireModel, "wireModel") ?? "gpt-image-1";
      if (!apiKey || !context.pool) throw new Error("openai.images 需要 apiKey 凭据引用");
      return { endpoint: createOpenAiImageProvider({
        instance: context.instance, pool: context.pool, baseUrl, apiKey, wireModel,
        concurrency: runtimeConfigPositiveInteger(config.defaultConcurrency, "defaultConcurrency") ?? 2,
        requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 180_000,
      }) };
    },
  })],
};
```
注：`runtimeConfig*` 的确切函数名/签名以 `$HYPIT_REPO/packages/runtime-kit/src/index.ts` 为准，发现出入按上游改并在报告注明。

- [ ] **Step 4: 宿主机 Profile 接入**

`projects/default/hypit.runtime.json`（宿主机这份当前只有 media.local/hyperframes.local）增加：
```json
"credentials": { "file": { "use": "@hypit/credential-store-file", "config": { "path": "credentials" } } },
```
endpoints 增加 `"openai.images"`（spec §4 的 openai 配置块），bindings 增加 `"@hypit/gpt-image@1#gpt-image-2": "openai.images"`。

- [ ] **Step 5: 端到端验证（本任务的核心交付）**

```bash
pnpm providers:setup && pnpm install && pnpm providers:build
cd projects/default
node $HYPIT_REPO/bin/hypit.mjs doctor --endpoint openai.images --json
node $HYPIT_REPO/bin/hypit.mjs auth status openai.images --json
```
Expected：doctor 无 activation/加载类 error（凭据未配置的 error 属预期）；auth status 返回 `hypit.cli-auth-status@1` 且 credentials 含 `slot:"apiKey"`、`label:"OpenAI 兼容服务 API Key"`、`configured:false`。
若解析失败（找不到包 / 找不到 @hypit/hypit / .ts 不能 import），按 spec §7 回退方案排查；**这是本任务允许花时间的地方**，解决方式写进报告。

- [ ] **Step 6: Commit**（`feat: Provider 骨架与项目本地包解析链路`）

---

### Task 2: OpenAI 兼容图像 Provider 完整实现 + 测试

**Files:** Modify `provider.ts`；Create `test/provider.test.ts`

**实现前先核对 API**：WebFetch `https://platform.openai.com/docs/api-reference/images` 确认 generations/edits 的字段与响应（b64_json）。

**行为契约：**
- `supports()`：ports 里出现映射表外的 port → unsupported；aspectRatio 只接受 `1:1|3:2|2:3`（映射 size `1024x1024|1536x1024|1024x1536`；缺省 1:1）；resolution 出现且 ≠"1K" → unsupported；images >16 → unsupported。reason 全中文。
- handler（immediate）：
  - 无 images：`POST {baseUrl}/v1/images/generations`，JSON `{ model: wireModel, prompt, size, background?, n:1 }`，header `Authorization: Bearer <apiKey.secret>`；
  - 有 images：`POST {baseUrl}/v1/images/edits`，`FormData`：`model`、`prompt`、`size`、每张图 `image`（`new Blob([bytes], {type: mediaType})`，字节来自 `context.resources.get(artifact.resource)`）；
  - 响应取 `data[0].b64_json` → `Buffer.from(b64, "base64")` → `resources.put(bytes, "image/png")` → `{ value: { kind: "inline", value: canonicalize(sealGeneratedImageSet({ images: [blob] })) } }`；
  - 非 2xx：解析 `error.message`，抛错文案做 URL 脱敏、不含 key；`AbortSignal.timeout(requestTimeoutMs)`。
- `reportProgress?.({ phase: "提交 OpenAI 图像请求" })` 提交前调用一次。

**测试**（模式照 `$HYPIT_REPO/examples/provider-package/.../test/provider.test.ts`，用 `EndpointRegistry`+`MemoryResourceStore` 来自 `@hypit/driver-node`——通过 symlink 的上游可 import；vitest 跑在包目录）用例：
1. generations 路径：假 fetch 断言 URL/headers/body 字段，返回 b64 后断言 resources 中产物与返回值结构；
2. edits 路径：有输入图时走 multipart 且包含图字节；
3. supports 拒绝 aspectRatio 4:5，reason 非空；
4. HTTP 401 时错误消息含状态码、不含 `test-key`。

Steps: 写测试（RED）→ 实现（GREEN）→ `pnpm providers:build` 通过 → doctor 复验 → Commit（`feat: OpenAI 兼容图像 Provider`）。

---

### Task 3: Gemini 图像 Provider + 测试

**Files:** Create `projects/default/packages/provider-gemini-image/{package.json,tsconfig.json,src/activation.ts,src/provider.ts,test/provider.test.ts}`；Modify `projects/default/hypit.runtime.json`（endpoint `gemini.images` + 2 条 bindings）

结构复制 Task 1/2 的包（名字、capability、白名单换掉）。**实现前 WebFetch `https://ai.google.dev/gemini-api/docs/image-generation` 核对**。

**契约：**
- 两个 capability（nano-banana-2 / nano-banana-pro）共用一个 handler 工厂，模型 ID 取 `modelMap[capability.name]`，空字符串 → handler 抛"请在配置中填写 Gemini 模型 ID（modelMap.<name>）"。
- 请求：`POST {baseUrl}/v1beta/models/{model}:generateContent`，header `x-goog-api-key: <secret>`；body `contents:[{ parts: [{ text: prompt }, ...images 转 { inline_data: { mime_type, data: <b64> } }] }]`，`generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio? , imageSize?("1K"|"2K"|"4K", 仅 pro) } }`。
- 响应：遍历 `candidates[0].content.parts`，取全部 `inlineData` → put → `sealGeneratedImageSet`；一张都没有 → 抛"Gemini 未返回图像（可能被安全策略拦截）"。
- `supports()`：aspectRatio 不在 Gemini 支持列表（`1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9`）→ unsupported；resolution 出现且模型是 nano-banana-2 且 ≠"1K" → unsupported；未知 port → unsupported。outputFormat 接受并忽略。
- activation 白名单：`["baseUrl","apiKey","modelMap","defaultConcurrency","requestTimeoutMs"]`；modelMap 用 `runtimeConfigObject` 读，值 `runtimeConfigString`。

**测试** 4 例：请求体断言（含 aspectRatio 透传）、b64 响应落库、模型 ID 为空的报错文案、supports 拒绝 32:9。

Commit（`feat: Gemini 图像 Provider（Nano Banana）`）。

---

### Task 4: 火山引擎 Provider（Seedance 异步 + Seedream 即时）+ 测试

**Files:** Create `projects/default/packages/provider-volcengine/{package.json,tsconfig.json,src/activation.ts,src/provider.ts,test/provider.test.ts}`；Modify `projects/default/hypit.runtime.json`（endpoint `volcengine.default` + 5 条 bindings）

**实现前 WebFetch 核对**（必做，字段以文档为准，出入写进报告）：
- `https://www.volcengine.com/docs/82379/1521309`（查询视频生成任务）
- 方舟"创建视频生成任务"文档（从上页导航可达）与 `images/generations` 文档。

**契约：**
- 4 个 Seedance capability 共用 `AsyncEndpoint` 工厂（模型 ID 取 modelMap，空 → start 直接 failed，code `VOLC_MODEL_ID_MISSING`，message 指导去方舟控制台确认并填入）。
- `start`：`POST {baseUrl}/api/v3/contents/generations/tasks`，header `Authorization: Bearer <secret>`、`content-type: application/json`；body `{ model, content: [ { type:"text", text: prompt + 参数后缀 }, ...图片项 ] }`。
  - 参数后缀由 ports 拼接：`--resolution <resolution>`、`--ratio <aspectRatio>`、`--duration <duration>`、generateAudio 为 false 时 `--audio false`（具体旗标名以文档为准，文档不一致时按文档）。
  - 图片项：`{ type:"image_url", image_url: { url: "data:<mediaType>;base64,<b64>" }, role: "first_frame"|"last_frame"|"reference_image" }`，字节来自 resources.get。
  - 成功取 `id` → `checkpoint({ handle, receipt: { id } })` → `wakeAfter(handle, pollIntervalMs)`；handle 形如 `{ contract: "workbench.volcengine-task@1", taskId, capability: <key>, startedAt }` 经 `canonicalize`。
  - 幂等：不重试提交（方舟无幂等键则提交即一次；超时未拿到 id = failed，遵守"提交超时无 receipt 是失败"）。
- `poll`：`GET .../tasks/{id}`；`queued|running` → `wakeAfter`（progress.phase=status）；`failed` → failed（携带方舟 error message，脱敏）；`succeeded` → `{ status: "ready", handle }`。本地超时 `startedAt + maxOperationMs(默认 20min)` → failed `VOLC_OPERATION_TIMEOUT`（注明远端结果未知）。
- `collect`：从任务响应 `content.video_url` 下载（无 Authorization），`resources.put(bytes, "video/mp4")` → `sealGeneratedVideoSet({ videos: [blob] })`。
- Seedream capability 为 immediate handler：`POST {baseUrl}/api/v3/images/generations` body `{ model, prompt, size, response_format: "b64_json", watermark: false, image?: [dataUrls] }`；size 由 quality 档（basic→"1K"、high→"2K"、ultra→"4K"，文档若要求像素则按 aspectRatio 换算）；响应 `data[0].b64_json` → imageSet。
- `supports()`：Seedance——referenceVideo/referenceAudio/webSearch 出现 → unsupported（"方舟直连暂不支持该输入"）；Seedream——nsfwCheck 接受并忽略；未知 port → unsupported。
- activation 白名单：`["baseUrl","apiKey","modelMap","defaultConcurrency","pollIntervalMs","requestTimeoutMs"]`；`actionLimits: { submit:{concurrency:1}, poll:{concurrency:4}, collect:{concurrency:1} }`。

**测试** 6 例：start 请求体（含参数后缀与 first_frame base64）、start 返回 pending + receipt、poll running→pending / succeeded→ready、collect 下载落库为 videoSet、模型 ID 缺失的 failed 文案、Seedream immediate 全流程。

Commit（`feat: 火山引擎 Provider（Seedance/Seedream 直连）`）。

---

### Task 5: Profile 收口 + 全端点验收

**Files:** Modify `projects/default/hypit.runtime.json`（确认 3 endpoints + 8 bindings + file credentials 全量、格式与 spec §4 一致）

- [ ] `pnpm providers:build` 全绿；
- [ ] `cd projects/default && node $HYPIT_REPO/bin/hypit.mjs doctor --json`：除 3 个"凭据未配置" error 外无其他 error；
- [ ] `auth status` 三个实例各显示 `apiKey` slot（label 中文）；
- [ ] 给 `openai.images` 用 `auth login openai.images --from <(echo test-key)` 写入假 key → doctor 该实例 error 消失 → `auth logout` 清掉；
- [ ] 运行 workbench 后端（HYPIT_PROJECT=projects/default），`GET /api/profile` 往返 PUT 校验通过（上游解析器接受新 Profile）；
- [ ] Commit（`feat: 直连 Provider 接入 Runtime Profile`）。

---

### Task 6: 前端三张厂商卡（Models 页）

**Files:** Modify `web/src/pages/Models.tsx`

把"生成模型服务未接入"占位卡替换为一个 `PROVIDERS` 常量驱动的卡片组：

```ts
const PROVIDERS = [
  { instance: "volcengine.default", use: "@workbench/provider-volcengine", title: "火山引擎（方舟）",
    desc: "Seedance 生视频 ×4 · Seedream 生图", credLabel: "方舟 API Key",
    models: [["seedance-2","Seedance 2.0"],["seedance-2-fast","Seedance 2.0 Fast"],["seedance-2-mini","Seedance 2.0 Mini"],["seedance-2.5","Seedance 2.5"],["seedream-5-lite","Seedream 5 Lite"]],
    modelField: "modelMap", defaults: { /* spec §4 volcengine config 块 */ },
    bindings: { "@hypit/seedance@1#seedance-2": "volcengine.default", "@hypit/seedance@1#seedance-2-fast": "volcengine.default", "@hypit/seedance@1#seedance-2-mini": "volcengine.default", "@hypit/seedance@1#seedance-2.5": "volcengine.default", "@hypit/seedream@1#seedream-5-lite": "volcengine.default" } },
  { instance: "openai.images", use: "@workbench/provider-openai-image", title: "OpenAI 兼容",
    desc: "GPT Image 生图 · baseUrl 可改为任意中转站", credLabel: "API Key",
    models: [["wireModel","线上模型 ID"]], modelField: "wireModel",
    defaults: { /* spec §4 openai 块 */ }, bindings: { "@hypit/gpt-image@1#gpt-image-2": "openai.images" } },
  { instance: "gemini.images", use: "@workbench/provider-gemini-image", title: "Google Gemini",
    desc: "Nano Banana 生图/改图", credLabel: "Gemini API Key",
    models: [["nano-banana-2","Nano Banana 2"],["nano-banana-pro","Nano Banana Pro"]],
    modelField: "modelMap", defaults: { /* spec §4 gemini 块 */ },
    bindings: { "@hypit/nano-banana@1#nano-banana-2": "gemini.images", "@hypit/nano-banana@1#nano-banana-pro": "gemini.images" } },
] as const;
```

每张卡（endpoint 存在时）：状态徽标（该 endpoint 的 auth status，`load()` 改为按存在的 PROVIDERS 实例并行拉取）、API Key password 输入 + 保存（POST /api/auth/:instance，成功清空）、baseUrl 输入、模型 ID 输入（modelMap 逐项 / wireModel 单项，patch 进 env 状态）、「测试」按钮（doctor?endpoint=）。endpoint 不存在时：卡片显示「未启用」+「启用」按钮 → 把 `defaults` 写入 `endpoints[instance]`、合并 `bindings`、确保 `credentials.file` 存在，然后直接 PUT 保存。保留页面底部统一「保存配置」。HypiHub 卡逻辑保留不动（endpoint 存在才显示，现状不存在即隐藏）。

验证：`pnpm check` + `cd web && pnpm build` 干净；dev 起后端+前端，页面上「启用」→ 保存 → 刷新往返一致；「测试」按钮返回 doctor 文案。Commit（`feat: 模型与服务页三张直连厂商卡`）。

---

### Task 7: Docker 集成 + README/spec 收尾

**Files:** Modify `docker/Dockerfile`、`docker/entrypoint-runtime.sh`、`docker/entrypoint-workbench.sh`、`docker/runtime.docker.json`、`docker/smoke.sh`、`README.md`

- Dockerfile：COPY `hypit-workbench/projects/default/`（package.json + packages 源码）到 `/opt/workbench-providers/`（作为镜像内种子）；构建期 `ln -sfn /opt/hypit` 为其建 SDK 链接并 `tsc` 编译各包（用 workbench 已装的 typescript：`node /opt/workbench/node_modules/typescript/bin/tsc -p <pkg>`）。
- entrypoint（两个都要）：若 `/projects/default/packages` 缺失或某包无 `dist/`，从 `/opt/workbench-providers` 同步（`cp -rn` 源码 + dist）；每次启动 `mkdir -p /projects/default/node_modules/@hypit && ln -sfn /opt/hypit /projects/default/node_modules/@hypit/hypit`；确保 `package.json` 存在。
- `runtime.docker.json`：加入 spec §4 的 3 个 endpoints + 8 bindings + file credentials（容器默认即三家可配状态）。注意 entrypoint 只在 Profile 缺失时复制模板——已有用户 Profile 不覆盖（现状行为，保持）。
- smoke.sh：追加 `docker compose exec -T runtime node /opt/hypit/bin/hypit.mjs doctor --json` 断言除 3 个凭据 error 外无其他 error（jq 或 node -e 过滤 code=="RUNTIME_CREDENTIAL_MISSING"）。
- README：模型配置一节改写——三家直连为默认路径（各卡怎么填、方舟模型 ID 去哪查、OpenAI 卡怎么接中转站），HypiHub 降为附注；已知限制增加"语音能力暂无直连 Provider"。
- 完整验证：`docker compose build && down && up -d` → smoke 全绿 → 浏览器手动确认 Models 页三卡可用（报告附 curl 层面的等效验证）。
- Commit（`feat: 直连 Provider 的 Docker 集成与文档`）。

---

## Self-Review

- Spec 覆盖：§3/4/5 → Task 1-4；§7 → Task 1/7；§8 → Task 6；§9 → Task 2/3/4 测试 + Task 5/7 验收；§10 风险 → Task 1 先行 + 各任务"实现前 WebFetch 核对"。
- 无 TBD；各厂商 API 字段标注"以官方文档为准，出入写报告"，是验证指令而非缺口。
- 类型一致性：`createXxxProvider` 选项、instance 名、capability key、config 白名单在 Task 1-6 间逐字一致；Task 6 的 `defaults` 引用 spec §4 的 config 块（实现时逐字复制）。
- 有意为之的偏离：本计划对 Task 2-4 给行为契约与测试清单而非全量代码——实现者需照 `examples/provider-package` 模板与研究文档工作，任务审查以契约逐条核对。
