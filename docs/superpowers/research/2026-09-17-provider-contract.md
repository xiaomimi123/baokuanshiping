# Hypit 自建 Provider 契约调研（供直连 Provider 实现参考）

仓库根 `<repo>` = `../hypit`（上游，只读）。本文为实现直连 Provider 的权威参考；不确定处以上游源码为准。

## TL;DR

一个自建 Provider 包 = 普通 npm 包，满足 4 件事：

1. `package.json` 声明 `"hypit": { "activation": "./dist/activation.js" }`，`"type": "module"`；
2. `activation.js` 默认导出 `{ format: "hypit.node-package@1", hostFacets: [createRuntimeEndpointAdapterFacet({ use: "<包名>", activate(ctx){...} })] }`（`use` 必须等于包名 + Profile 里的 `use`）；
3. `activate()` 返回 `{ endpoint: defineEndpointPackage({...}) }`：`capabilities[]` 声明实现的 capability（如 `@hypit/gpt-image@1#gpt-image-2`）、`returns`、`lifecycle`、`supports()`、`endpoint`/`handler`；
4. 项目 `hypit.runtime.json`：`endpoints.<instance>.use = "<包名>"` + `bindings["<module>@<ver>#<capability>"] = "<instance>"`。

产物通过 `context.resources.put(bytes, mediaType)` 写入 ResourceStore，返回
`{ kind: "inline", value: canonicalize(sealGeneratedImageSet({ images: [blobRef] })) }`（视频用 `sealGeneratedVideoSet({ videos })`）。

## 关键 API（`@hypit/hypit/endpoint-kit`，源码 `<repo>/packages/endpoint-kit/src/index.ts`）

- `defineEndpointPackage(options)`（L308-329）：`module`（`{name,version}`）、`facet`、`instance`、`pool`、`credentials: {slot: CredentialRef}`、`credentialInputs: {slot: {label, kind?, acquisition?}}`、`defaultConcurrency`、`actionLimits: { submit/poll/collect: {concurrency?, rate?} }`、`pricing: {kind:"page",url}`（必须 HTTPS）、`capabilities`。
- capability 条目：`{ capability: CapabilityRef, returns: TypeRef, lifecycle: "immediate"|"asynchronous", supports?: (req)=>{status:"supported"}|{status:"unsupported",reason}, handler | endpoint, transient?, capacity?, maxConcurrency? }`。
- `EndpointRequest`：`{ capability, returns, constraints, pendingInputs? }`；`constraints` 实为 `GenerationRequest`（`{ ports: Record<string, GenerationPortValue[]> }`，媒体项 `{ artifact: BlobRef, role?, fields? }`）。示例读法：`(request.constraints as unknown as GenerationRequest).ports`。
- `AsyncEndpoint = { start(ctx), poll(ctx), cancel?(ctx), collect?(ctx) }`；`EndpointOutcome = {status:"pending",handle,wakeAt?,progress?} | {status:"completed",result:{value}} | {status:"failed",failure:{code,message}} | {status:"ready",handle}`，均可带 `receipt: {id,url?}`（只放非机密任务 ID）。`wakeAfter(handle, delayMs, now?, progress?)` 辅助生成 pending。
- Immediate：`handler: (ctx: EndpointInvocationContext) => Awaitable<{ value: StoredValue }>`。
- Context：`{ command, need, resources: ResourceStore, credentials: Record<slot, {secret, replace?}>, reportDiagnostic?, reportProgress? }`；start/poll 额外有 `operation`（幂等键）与 `checkpoint?`、`handle`。
- 失败语义：`failed`/抛异常 = 本地执行尝试结束（不断言远端结束）；提交超时且无 receipt 是失败不是 pending。

## 运行时 facet（`@hypit/hypit/runtime-kit`）

`createRuntimeEndpointAdapterFacet({ use, activate(context) })`；`context = { hostStateRoot, dataRoot, instance, pool, config }`。
config 读取用 `runtimeConfigObject/runtimeConfigExact(白名单!)/runtimeConfigString/runtimeConfigPositiveInteger/runtimeConfigCredentialRef`。
`activate()` 返回的 `endpoint.instance.id` 必须 === `context.instance`。

## capability 名与 binding key

capability 名 = 模型包 port table 的 `model` 字段；binding key = `` `${module.name}@${module.version}#${name}` ``（version 是逻辑接口版本 "1"，非 npm 版本）。

| 模型包 | capability | result 类型 | 主要 ports |
| --- | --- | --- | --- |
| `@hypit/seedance@1` | `seedance-2`, `seedance-2-fast`, `seedance-2-mini`, `seedance-2.5` | videoSet | prompt, referenceImage, referenceVideo, referenceAudio, firstFrame, lastFrame, resolution, aspectRatio, duration, generateAudio, webSearch |
| `@hypit/gpt-image@1` | `gpt-image-2` | imageSet | prompt, aspectRatio(16 种), resolution(1K/2K/4K), background, images(≤16) |
| `@hypit/nano-banana@1` | `nano-banana-2`, `nano-banana-pro` | imageSet | prompt, images, aspectRatio, resolution, outputFormat(png/jpg) |
| `@hypit/seedream@1` | `seedream-5-lite` | imageSet | prompt, aspectRatio, quality(basic/high/ultra), outputFormat, nsfwCheck, images(≤14) |

`returns` 用 `generationTypes.imageSet / videoSet`（`@hypit/hypit/generation`）；resolve 时 returns 不同会表现为 missing。

## 项目本地包解析（`<repo>/packages/package-loader-node/src/location.ts:180-236`）

- 非 `@hypit/` 名字解析顺序：项目根向上 `node_modules/<name>` → **约定路径 `<projectRoot>/packages/<包名最后一段>/package.json` 且其 `name` === 完整包名**（无需 npm install 即可被找到）→ node_modules 兜底。
- `@hypit/` 开头的 `use` 只在 Distribution 里找（防顶替）。
- Provider 自身 `import "@hypit/hypit/endpoint-kit"` 由 Node/宿主 loader 解析：需要项目 `node_modules/@hypit/hypit` 可解析到上游（源码 checkout 场景用 **symlink → 上游仓库根**；上游 package.json 的 exports 指向 TS 源码，宿主 worker 运行在 tsx 下可直接吃）。这是最大不确定点，Task 1 骨架先验证。
- 项目边界：从项目目录运行 CLI，或 `--workspace`；项目根需有 `package.json`。
- `hypit packages install` 与此无关（那是 Distribution 管上游 npm 资产的）。

## 凭据

- `defineEndpointPackage` 里 `credentials: { apiKey: credentialRef(store, key) }` + `credentialInputs: { apiKey: { label } }` → `hypit auth login <instance>` 自动认识该 slot（workbench 的 POST /api/auth/:endpoint 直接可用）。
- 执行期 `context.credentials.apiKey.secret`；未配置时框架报统一错误。
- 错误消息纪律：不得泄露签名 URL / key；上游用 `reason.replace(/https?:\/\/\S+/g, "[redacted-url]")`。

## 参考实现

- 完整教学示例：`<repo>/examples/provider-package/packages/provider-images/`（activation.ts 24 行、provider.ts 150 行、假 fetch 生命周期测试）。**新 Provider 以它为模板。**
- 生产参考：`<repo>/packages/provider-hypihub/src/provider.ts`（start L466-487：POST + `idempotency-key: context.operation` + checkpoint + receipt；poll L488-506：本地超时 + 状态机；collect L507-514：下载 → resources.put → sealSet）。
- 测试基建：`@hypit/driver-node` 的 `EndpointRegistry` + `MemoryResourceStore`（仅 devDependency）。

## 硬性纪律（踩了直接报错）

1. `use` ≠ facet 名 → not registered；2. endpoint.instance.id ≠ context.instance；3. config 白名单外键报错；4. pricing page 必须 HTTPS；5. transient 仅 immediate；6. binding value 必须是本 Profile 的 instance；7. returns 不匹配 = missing；8. unsupported reason 不能为空；9. credentialInputs slot 必须有对应 credentials；10. `hypit.activation` 必须包内相对路径且默认导出 `format:"hypit.node-package@1"`。
