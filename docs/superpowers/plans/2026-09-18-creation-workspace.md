# 创作工作台（第一期）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台新增「创作」页：模板起项目 → 上传素材/转写 → 变量表单 → 一键 build → 任务页内联预览成片。

**Architecture:** 后端在既有 Fastify 上加 projects/templates 两组路由（薄封装 hypit CLI + 文件操作），模板为上游 examples 白名单原样复制，变量编辑用锚点子串替换；前端新增 /create 路由三步向导。

**Tech Stack:** 既有栈 + `@fastify/multipart`。上游 `$HYPIT_REPO=/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit`（只读）。

**Spec:** `docs/superpowers/specs/2026-09-18-creation-workspace-design.md`（各节为准，本计划引用 §号）

## Global Constraints

- `$WB=/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit-workbench`；命令前缀 `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`；本机后端测试用 `PORT=8899`（8090 被 Docker 占用）。
- 提交 `feat:`/`fix:` 前缀，**不加任何署名行**；不修改上游仓库。
- 错误统一 `{ error: { code, message } }`；中文文案；路径参数 slug 校验 `[a-z0-9-_.]` 且解析后必须在 projects 根内。
- `.workbench.json` format 字面量 `workbench.project@1`。
- 前端只用既有设计系统类；新增 CSS 类允许但须进 styles.css 并与现有 token 一致。
- CLI 输出结构（`transcribe`/`inspect`/`build` 的 --json）实现期以 `$HYPIT_REPO/packages/cli` 源码核对，出入写报告。

## File Structure

```
server/src/
├── templates.ts            # Task 1：模板注册表 + 验证结果缓存
├── projects.ts             # Task 2：项目元数据/复制/路径安全工具（纯函数为主）
└── routes/
    ├── templates.ts        # Task 1：GET /api/templates
    └── projects.ts         # Task 2-4：projects CRUD/assets/variables/transcribe/build
server/test/
├── projects.test.ts        # 路径安全、元数据读写、模板复制排除
└── variables.test.ts       # 锚点替换
web/src/pages/
├── Create.tsx              # Task 5：项目列表 + 三步向导 + 项目详情
└── Builds.tsx              # Task 6：产物内联预览增强
docker/smoke.sh             # Task 7：templates 断言
```

---

### Task 1: 模板注册表 + 实测白名单 + GET /api/templates

**Files:** Create `server/src/templates.ts`, `server/src/routes/templates.ts`; Modify `server/src/index.ts`（注册路由）

**先做实测（本任务核心，结论写报告）**：对候选 `semantic-composition`、`podcast`、`ranking-football`、`interview`、`complex-explainer`，在临时目录各复制一份（排除 node_modules/.hypit），换用 default 的 Profile，跑 `hypit check <runSource> --json` 与 `hypit plan <runSource> --json`，记录：能否通过、需要哪些 capability/endpoint、缺什么素材。据此定稿白名单与每模板的 `requires`（capability 中文名列表）与 `runSource`。**至少确保一个免模型模板可用**（预计 semantic-composition 的 chat）。

**Interfaces produced:**
```ts
export type TemplateDef = {
  id: string; title: string; description: string;
  sourceDir: string;            // 相对 $HYPIT_REPO/examples
  runSource: string;            // 相对项目根
  requires: { capability: string; label: string }[];   // 空数组 = 免模型
  variables: VariableDef[];     // Task 3 消费；本任务先给出每模板 3-8 条（锚点从源文件实取）
  cover?: string;               // 相对 sourceDir 的图片路径，可无
};
export type VariableDef = { key: string; label: string; kind: "text" | "number" | "asset"; file: string; anchor: string };
export const TEMPLATES: TemplateDef[];
export async function templateAvailability(): Promise<Record<string, { ok: boolean; missing: string[] }>>;
  // 读当前 Profile endpoints+bindings 判断 requires 是否已配置（不跑 doctor，纯读 Profile），60s 内存缓存
```
路由 `GET /api/templates` → `{ templates: (TemplateDef & { availability })[] }`（anchor 字段不下发前端，避免泄露实现细节——下发 key/label/kind 即可）。

Steps: 实测各模板 → 编写注册表（变量锚点逐个从源文件复制原文验证唯一）→ 路由 + index.ts 注册 → `curl 127.0.0.1:8899/api/templates` 验证 → 全套 server 测试不回归 → Commit `feat: 模板注册表与可用性接口`。

---

### Task 2: 项目层（创建/列表/详情/路径安全）+ 单测

**Files:** Create `server/src/projects.ts`, `server/src/routes/projects.ts`, `server/test/projects.test.ts`; Modify `server/src/index.ts`

**Interfaces produced:**
```ts
// projects.ts（纯函数 + 少量 fs）
export function assertSlug(name: string): void;                  // 不合法抛 400 语义错误
export function projectDir(name: string): string;                // 校验并拼 projects 根内路径
export type ProjectMeta = { format: "workbench.project@1"; template: string; title: string;
  createdAt: string; runSource: string; builds: string[]; variables?: Record<string, string> };
export async function readMeta(name: string): Promise<ProjectMeta>;
export async function writeMeta(name: string, meta: ProjectMeta): Promise<void>;
export async function createProject(template: TemplateDef, title: string): Promise<{ name: string }>;
  // slug(title)+4位随机；复制 sourceDir（排除 node_modules/.hypit/hypit.runtime.json）；
  // 复制 projects/default/hypit.runtime.json 进项目并写 .hypit/runtime 指针（spec §3；若实测 --runtime 方案更优可改，报告注明）；
  // mkdir assets/uploads；写 .workbench.json
export async function listProjects(): Promise<(ProjectMeta & { name: string })[]>;   // 忽略无元数据目录与 default
```
路由：`GET /api/projects`、`POST /api/projects`（template 不存在 404）、`GET /api/projects/:name`（含素材清单：assets/uploads 下 {file,size,type}）。

单测（TDD）：assertSlug 拒绝 `../x`、`a/b`、空、含大写强制小写化或拒绝（实现者选一并测死）；createProject 排除项生效（临时目录模拟模板源）；readMeta/writeMeta 往返；listProjects 忽略 default 与脏目录。

Steps: RED → 实现 → GREEN → 手动 curl 从真实模板建项目成功（报告留输出与目录树）→ Commit `feat: 视频项目层与创建接口`。

---

### Task 3: 素材上传/删除 + 变量锚点替换 + 单测

**Files:** Modify `server/src/routes/projects.ts`, `server/src/projects.ts`; Create `server/test/variables.test.ts`; Modify `server/package.json`（加 `@fastify/multipart`）、`server/src/index.ts`（注册插件，限 512MB）

**Interfaces produced:**
```ts
export async function applyVariables(name: string, defs: VariableDef[], values: Record<string, string>): Promise<void>;
// 对每个提交的 key：当前锚点 = meta.variables?.[key] ?? def.anchor；
// 读 def.file，锚点出现次数必须恰为 1（0 或 >1 → 抛 { code:"E_ANCHOR", message: 含变量 label }）；
// 替换后写回（临时文件+rename 原子写），meta.variables[key] = 新值；kind:"asset" 校验目标文件存在于 assets/uploads/
```
路由：`POST /api/projects/:name/assets`（multipart 单/多文件；文件名 slug 化保扩展名；仅 mp4/mov/webm/mp3/wav/m4a/png/jpg/jpeg/webp/gif；返回清单）、`DELETE /api/projects/:name/assets/:file`、`PUT /api/projects/:name/variables`。

单测（TDD，variables.test.ts 用临时目录假模板文件）：唯一锚点替换成功且二次替换（新值作锚点）成功；锚点不唯一 → E_ANCHOR 且文件未变；asset 类型引用不存在文件 → 400；原子写（替换后无 .tmp 残留）。

Steps: RED → 实现 → GREEN → 手动：真实项目传一张图 + 改一个 text 变量，cat 源文件确认替换 → Commit `feat: 素材上传与变量编辑`。

---

### Task 4: 转写 + Build 发起

**Files:** Modify `server/src/routes/projects.ts`

先核对 CLI：`node $HYPIT_REPO/bin/hypit.mjs transcribe --help` 与 `build --help` 的参数形态、`--json` 输出结构（读 `$HYPIT_REPO/packages/cli` 对应实现），出入以实际为准写报告。

路由：
- `POST /api/projects/:name/transcribe` body `{ asset }`：asset 必须在 uploads 白名单内；先纯读 Profile 判断转写能力是否有可用 endpoint（whisperx 本地或已配的模型 binding；判断逻辑与 Task 1 templateAvailability 同源复用），没有 → 409 `{ code:"E_NO_TRANSCRIBER", message: 引导去模型页 }`；有 → 跑 CLI（cwd=项目，超时 10 分钟），返回 `{ text }`（或 CLI 实际输出形态）。
- `POST /api/projects/:name/build`：`runHypit(["build", meta.runSource], { cwd: projectDir, timeoutMs: 120_000 })`（提交即返回，不 --follow；id 从输出取，结构核对后定）；追加 meta.builds；Runtime 未就绪的 CLI 错误透传为 502 并附中文提示。

验证：免模型模板真实走通 build 提交（Runtime Worker 需在跑；产物完成与否交任务页，本任务只验提交返回 id 且 `GET /api/builds/:id` 可查）。Commit `feat: 转写与出片接口`。

---

### Task 5: 前端「创作」页

**Files:** Create `web/src/pages/Create.tsx`; Modify `web/src/App.tsx`（导航加「创作」/create）、`web/src/main.tsx`（路由）、`web/src/api.ts`（新类型：TemplateInfo/ProjectMeta/AssetInfo）、`web/src/styles.css`（向导步骤条/上传区/模板卡等新类）

单文件三视图（内部状态切换）：项目列表（默认）/ 新建向导（三步）/ 项目详情。按 spec §6：
- 模板卡：title/description/requires 徽标（availability.ok=false 显示"需先配置：X"且选中禁用，链接 /models）
- 上传：`<input type=file multiple>` + 拖拽区；XHR/fetch 进度条（简单实现：per-file fetch，完成后刷新清单）；删除按钮
- 转写：视频/音频素材行内按钮，结果 textarea 展示可复制；409 时按钮置灰 + 提示
- 变量表单：text→input、number→input[type=number]、asset→下拉（选项=已上传素材）；「保存修改」= PUT variables；E_ANCHOR 错误按变量名标红
- 「开始生成」：POST build → `navigate("/builds")` 前把 buildId 存 sessionStorage，Builds 页读取后自动选中（Builds.tsx 加 3 行读取逻辑，本任务顺带）
- 项目详情：素材+变量（同向导②③）+ Build 历史列表（meta.builds 逐个显示 id + 跳任务页链接）

验证：`pnpm check` + `cd web && pnpm build` 干净；dev 起前后端，curl 层面等效验证向导链路（建项目→传素材→存变量→build）。Commit `feat: 创作页（模板向导与项目管理）`。

---

### Task 6: 任务页产物内联预览

**Files:** Modify `web/src/pages/Builds.tsx`, `web/src/api.ts`

先核对 `hypit inspect <id> --json`（`hypit.cli-inspect@1`）的输出结构（读 `$HYPIT_REPO/packages/cli/src`，找 Output 名与 MIME 所在字段）。后端不动——前端在 build 详情 result complete 时调 `GET /api/builds/:id` 已有数据不含产物名，则加后端一行路由 `GET /api/builds/:id/outputs`（`hypit inspect --json` 透传）——按核对结果取舍，报告注明。

前端：详情卡下方「产物」区——video/* 用 `<video controls src="/api/builds/{id}/outputs/{name}">`（浏览器可流式播）、image/* 用 `<img>`、其他为下载链接；每项都带下载按钮。复合目录产物（E_COMPOSITE_OUTPUT）显示提示文案不内联。

验证：用 Task 4 跑出的真实 build 验证视频内联播放 + 下载；`pnpm check`+build 干净。Commit `feat: 任务页产物内联预览`。

---

### Task 7: Docker 集成 + smoke + README

**Files:** Modify `docker/smoke.sh`（GET /api/templates 断言返回非空 templates 数组）、`README.md`（快速开始加"创作页"一节：三步向导流程、模板清单与各自所需服务、上传大小限制、转写前提）、`docker/Dockerfile`（若 @fastify/multipart 需要——实际 pnpm install 已覆盖，确认即可）

验证：`docker compose build && docker compose stop && docker compose up -d` → smoke 全绿 → 容器内从 chat 模板 curl 建项目 → build → 产物接口可下载（完整端到端，输出进报告）。Commit `feat: 创作页 Docker 集成与文档`。

---

## Self-Review

- Spec 覆盖：§3 数据布局→T2；§4 API→T1-4；§5 变量机制→T3；§6 前端→T5-6；§7 Docker→T7；§8 测试→T2/T3 单测+T7 端到端；§9 风险→T1 实测白名单先行。
- 无 TBD；CLI 输出结构、Profile 方案（复制 vs --runtime）、inspect 数据源三处标注"实现期核对，报告注明"为验证指令。
- 类型一致性：TemplateDef/VariableDef 由 T1 产、T2/T3/T5 消费，签名逐字一致；错误 code（E_ANCHOR/E_NO_TRANSCRIBER）前后端一致。
