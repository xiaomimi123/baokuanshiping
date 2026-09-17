# Hypit Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 容器化 Hypit 并提供一个仿 hypit.ai 风格的中文 Web 工作台（模型/服务配置 + 任务面板 + Studio 入口）。

**Architecture:** 单 Docker 镜像（node22 + 系统 chromium + ffmpeg + uv + socat）跑两个 compose 服务：`runtime`（Hypit Worker）与 `workbench`（Fastify 后端 + React 前端 + Studio 子进程）。后端全部是对 `hypit … --json` CLI 的薄封装，Profile 写入前用上游自己的解析器校验。

**Tech Stack:** TypeScript、Fastify 5、Vite 7 + React 18、vitest、Docker Compose。上游 hypit 仓库位于 `../hypit`（不修改）。

**Spec:** `docs/superpowers/specs/2026-09-17-hypit-workbench-design.md`

## Global Constraints

- Node ≥ 22.15（与上游一致）；本机开发用 `~/.nvm/versions/node/v22.23.2/bin` 前缀 PATH。
- 上游仓库绝对路径：`/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit`（下称 `$HYPIT_REPO`）。工作台仓库：`/Users/lizhishaoniange/Documents/hpyit爆款视频复刻/hypit-workbench`（下称 `$WB`）。
- 不修改 `$HYPIT_REPO` 内任何文件。
- 容器内浏览器只能通过 `hyperframes.local.config.chromePath` 指定（环境变量无效）；chromium 需 `--no-sandbox` 包装脚本。
- 凭据不落日志；临时凭据文件 0600、用后即删。
- 界面语言中文；视觉 token：纸白 `#FFFFFF`、近黑 `#010101`、品牌粉 `#E83F5F`、渐变 `#E94765→#F1738C→#F6A9BD`、边框 `#EAEAEA`。
- 所有服务端口只绑定 127.0.0.1（compose `ports` 用 `127.0.0.1:` 前缀）。
- 提交信息用 `feat:`/`fix:`/`docs:`/`test:` 前缀，结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## File Structure

```
hypit-workbench/
├── package.json                 # 根：pnpm workspace + 脚本
├── pnpm-workspace.yaml
├── .gitignore
├── README.md                    # Task 11
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── entrypoint-runtime.sh
│   ├── entrypoint-workbench.sh
│   └── runtime.docker.json
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # Fastify 装配 + 静态托管 web/dist
│   │   ├── config.ts            # 环境变量解析（HYPIT_REPO/HYPIT_PROJECT/PORT）
│   │   ├── hypit.ts             # runHypit(args) → 解析 --json 输出
│   │   ├── validate-profile.ts  # 借上游 tsx + config.ts 校验 Profile
│   │   ├── scripts/validate-profile-entry.ts
│   │   └── routes/
│   │       ├── runtime.ts       # /api/health /api/runtime/* /api/doctor
│   │       ├── profile.ts       # GET/PUT /api/profile
│   │       ├── auth.ts          # GET/POST/DELETE /api/auth/:endpoint
│   │       ├── builds.ts        # /api/builds*
│   │       └── studio.ts        # POST /api/studio, GET /api/studio
│   └── test/
│       ├── hypit.test.ts
│       ├── profile.test.ts
│       └── auth.test.ts
└── web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx              # 路由 + 侧栏布局
        ├── api.ts               # fetch 封装 + 类型
        ├── styles.css           # 设计系统（CSS 变量 + 组件类）
        └── pages/
            ├── Dashboard.tsx
            ├── Models.tsx
            ├── Builds.tsx
            └── Studio.tsx
```

---

### Task 1: 仓库脚手架（workspace、gitignore、server/web 包）

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `server/package.json`, `server/tsconfig.json`, `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`

**Interfaces:**
- Produces: 根脚本 `pnpm dev:server`、`pnpm dev:web`、`pnpm build`、`pnpm test`；后续任务直接可 `pnpm install`。

- [ ] **Step 1: 写根配置**

`package.json`:
```json
{
  "name": "hypit-workbench",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=22.15.0" },
  "scripts": {
    "dev:server": "pnpm --filter @workbench/server dev",
    "dev:web": "pnpm --filter @workbench/web dev",
    "build": "pnpm --filter @workbench/web build",
    "start": "pnpm --filter @workbench/server start",
    "test": "pnpm --filter @workbench/server test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - server
  - web
```

`.gitignore`:
```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: server 包配置**

`server/package.json`:
```json
{
  "name": "@workbench/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "fastify": "^5.0.0",
    "tsx": "^4.21.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: web 包配置**

`web/package.json`:
```json
{
  "name": "@workbench/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0"
  }
}
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8090" },
  },
});
```

- [ ] **Step 4: 安装并验证**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" && cd "$WB" && pnpm install`
Expected: 安装成功，无 error。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: workspace 脚手架（server/web 包）"
```

---

### Task 2: `runHypit` —— CLI JSON 封装

**Files:**
- Create: `server/src/config.ts`, `server/src/hypit.ts`
- Test: `server/test/hypit.test.ts`

**Interfaces:**
- Produces:
  - `config.ts`: `export const cfg: { hypitRepo: string; project: string; port: number; nodeBin: string }`（env：`HYPIT_REPO` 默认 `../hypit` 的绝对化、`HYPIT_PROJECT` 默认 `$HYPIT_REPO`、`PORT` 默认 8090、`node` 用 `process.execPath`）。
  - `hypit.ts`: `export class HypitCliError extends Error { code: string; detail?: unknown }`；`export async function runHypit(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<Record<string, unknown>>` —— spawn `process.execPath $HYPIT_REPO/bin/hypit.mjs …args --json`，cwd 默认 `cfg.project`；stdout 解析为 JSON；若 `format === "hypit.cli-error@1"` 或退出码非 0 → 抛 `HypitCliError`。
  - `export function parseCliJson(stdout: string, exitCode: number): Record<string, unknown>`（纯函数，便于测试）。

- [ ] **Step 1: 写失败测试**

`server/test/hypit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseCliJson, HypitCliError } from "../src/hypit.js";

describe("parseCliJson", () => {
  it("解析正常 machine view", () => {
    const out = JSON.stringify({ format: "hypit.cli-doctor@1", ok: true, diagnostics: [] });
    expect(parseCliJson(out, 0)).toMatchObject({ format: "hypit.cli-doctor@1", ok: true });
  });
  it("cli-error 转 HypitCliError", () => {
    const out = JSON.stringify({ format: "hypit.cli-error@1", code: "E_X", message: "boom" });
    expect(() => parseCliJson(out, 1)).toThrowError(HypitCliError);
    try { parseCliJson(out, 1); } catch (e) {
      expect((e as HypitCliError).code).toBe("E_X");
      expect((e as HypitCliError).message).toBe("boom");
    }
  });
  it("非 JSON 输出 + 非零退出码 → HypitCliError(code=E_CLI)", () => {
    expect(() => parseCliJson("garbage", 2)).toThrowError(HypitCliError);
  });
  it("doctor ok=false 且 exit 1 是合法输出，不抛错", () => {
    const out = JSON.stringify({ format: "hypit.cli-doctor@1", ok: false, diagnostics: [{ severity: "error", code: "X", message: "m" }] });
    expect(parseCliJson(out, 1)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "$WB/server" && pnpm test`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`server/src/config.ts`:
```ts
import { resolve } from "node:path";

const repo = resolve(process.env.HYPIT_REPO ?? resolve(import.meta.dirname, "../../../hypit"));

export const cfg = {
  hypitRepo: repo,
  project: resolve(process.env.HYPIT_PROJECT ?? repo),
  port: Number(process.env.PORT ?? 8090),
  nodeBin: process.execPath,
};
```

`server/src/hypit.ts`:
```ts
import { execFile } from "node:child_process";
import { join } from "node:path";
import { cfg } from "./config.js";

export class HypitCliError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function parseCliJson(stdout: string, exitCode: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (exitCode !== 0) throw new HypitCliError("E_CLI", `hypit 退出码 ${exitCode}`, stdout.slice(0, 2000));
    throw new HypitCliError("E_PARSE", "hypit 输出不是 JSON", stdout.slice(0, 2000));
  }
  const view = parsed as Record<string, unknown>;
  if (view.format === "hypit.cli-error@1") {
    throw new HypitCliError(String(view.code ?? "E_CLI"), String(view.message ?? "hypit 命令失败"), view);
  }
  return view;
}

export function runHypit(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  const bin = join(cfg.hypitRepo, "bin/hypit.mjs");
  return new Promise((resolvePromise, reject) => {
    execFile(
      cfg.nodeBin,
      [bin, ...args, "--json"],
      { cwd: opts.cwd ?? cfg.project, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        const exitCode = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? Number((error as { code: number }).code)
          : error ? 1 : 0;
        try {
          resolvePromise(parseCliJson(stdout, exitCode));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd "$WB/server" && pnpm test`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 冒烟真实 CLI（手动步骤，不写入测试套件）**

Run: `cd "$WB/server" && HYPIT_REPO="$HYPIT_REPO" node --import tsx -e 'import("./src/hypit.js").then(async m => console.log(await m.runHypit(["runtime","status"])))'`
Expected: 打印 `format: "hypit.cli-runtime-status@1"` 的对象。

- [ ] **Step 6: Commit**

```bash
git add server && git commit -m "feat: runHypit CLI JSON 封装"
```

---

### Task 3: 只读路由（health / runtime status / doctor / builds）+ Fastify 装配

**Files:**
- Create: `server/src/index.ts`, `server/src/routes/runtime.ts`, `server/src/routes/builds.ts`

**Interfaces:**
- Consumes: `runHypit`, `cfg`（Task 2）。
- Produces HTTP API（后续前端消费；错误统一 `{ error: { code, message } }`，HTTP 502）：
  - `GET /api/health` → `{ ok: true }`
  - `GET /api/runtime/status` → `hypit.cli-runtime-status@1` 原样
  - `POST /api/runtime/up` / `POST /api/runtime/down` → 对应 CLI 原样（up 超时 10 分钟）
  - `GET /api/doctor?endpoint=xxx`（可重复）→ `hypit.cli-doctor@1` 原样
  - `GET /api/builds?limit=&before=` → `hypit.cli-builds@1` 原样
  - `GET /api/builds/:id` → `hypit.cli-status@1` 原样
  - `GET /api/builds/:id/logs?lines=` → `hypit.cli-logs@1` 原样
  - `export function buildServer(): FastifyInstance`（index.ts 导出，测试用；`main` 仅在直接运行时 listen）

- [ ] **Step 1: 实现路由**

`server/src/routes/runtime.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { runHypit } from "../hypit.js";

export async function runtimeRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/runtime/status", async () => runHypit(["runtime", "status"]));
  app.post("/api/runtime/up", async () => runHypit(["runtime", "up"], { timeoutMs: 600_000 }));
  app.post("/api/runtime/down", async () => runHypit(["runtime", "down"], { timeoutMs: 120_000 }));
  app.get<{ Querystring: { endpoint?: string | string[] } }>("/api/doctor", async (req) => {
    const eps = req.query.endpoint == null ? [] : ([] as string[]).concat(req.query.endpoint);
    return runHypit(["doctor", ...eps.flatMap((e) => ["--endpoint", e])], { timeoutMs: 120_000 });
  });
}
```

`server/src/routes/builds.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { runHypit } from "../hypit.js";

export async function buildsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; before?: string } }>("/api/builds", async (req) => {
    const args = ["builds"];
    if (req.query.limit) args.push("--limit", req.query.limit);
    if (req.query.before) args.push("--before", req.query.before);
    return runHypit(args);
  });
  app.get<{ Params: { id: string } }>("/api/builds/:id", async (req) => runHypit(["status", req.params.id]));
  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/api/builds/:id/logs",
    async (req) => runHypit(["logs", req.params.id, "--lines", req.query.lines ?? "200"]),
  );
}
```

- [ ] **Step 2: 装配 index.ts**

`server/src/index.ts`:
```ts
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { HypitCliError } from "./hypit.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { buildsRoutes } from "./routes/builds.js";
import { profileRoutes } from "./routes/profile.js";
import { authRoutes } from "./routes/auth.js";
import { studioRoutes } from "./routes/studio.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HypitCliError) {
      reply.status(502).send({ error: { code: error.code, message: error.message } });
    } else {
      app.log.error(error);
      reply.status(500).send({ error: { code: "E_INTERNAL", message: error.message } });
    }
  });
  app.register(runtimeRoutes);
  app.register(buildsRoutes);
  app.register(profileRoutes);
  app.register(authRoutes);
  app.register(studioRoutes);
  const webDist = resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: req.url } });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildServer().listen({ port: cfg.port, host: "0.0.0.0" });
}
```

注意：Task 4/5/6 才创建 profile/auth/studio 路由文件；本任务先创建三个空实现占位文件，使 import 可解析：

`server/src/routes/profile.ts`、`server/src/routes/auth.ts`、`server/src/routes/studio.ts` 暂各为：
```ts
import type { FastifyInstance } from "fastify";
export async function profileRoutes(_app: FastifyInstance) {}
```
（auth.ts 导出 `authRoutes`，studio.ts 导出 `studioRoutes`，内容同型。）

- [ ] **Step 3: 手动验证**

Run: `cd "$WB/server" && HYPIT_REPO="$HYPIT_REPO" pnpm dev` 起服务，另开命令：
`curl -s 127.0.0.1:8090/api/health && curl -s 127.0.0.1:8090/api/runtime/status | head -c 300 && curl -s 127.0.0.1:8090/api/builds | head -c 300`
Expected: 依次得到 `{"ok":true}`、`hypit.cli-runtime-status@1`、`hypit.cli-builds@1`。

- [ ] **Step 4: Commit**

```bash
git add server && git commit -m "feat: 只读 API（runtime/doctor/builds）与 Fastify 装配"
```

---

### Task 4: Profile 读写 + 上游校验

**Files:**
- Create: `server/src/validate-profile.ts`, `server/src/scripts/validate-profile-entry.ts`
- Modify: `server/src/routes/profile.ts`（替换占位）
- Test: `server/test/profile.test.ts`

**Interfaces:**
- Consumes: `cfg`。
- Produces:
  - `validate-profile.ts`: `export async function validateProfile(json: unknown): Promise<{ ok: true } | { ok: false; message: string }>` —— 把 JSON 写入临时文件，spawn `$HYPIT_REPO/node_modules/.bin/tsx $WB/server/src/scripts/validate-profile-entry.ts <tmpfile>`（cwd = `$HYPIT_REPO`），退出码 0 为通过，stderr 为错误消息。
  - HTTP：`GET /api/profile` → `{ path, profile }`（读 `cfg.project` 的 `.hypit/runtime` 指针所指文件；无指针时读 `<project>/hypit.runtime.json`）；`PUT /api/profile` body=`{ profile }` → 校验通过才写盘，返回 `{ ok: true }`，否则 400 `{ error: { code: "E_PROFILE", message } }`。

- [ ] **Step 1: 写校验入口脚本**

`server/src/scripts/validate-profile-entry.ts`（在上游 tsx 下运行，直接吃上游解析器）:
```ts
// 用法: tsx validate-profile-entry.ts <profile.json 的绝对路径>
// cwd 必须是 hypit 仓库根，以便解析 workspace 依赖。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [, , profilePath] = process.argv;
const configModule = resolve(process.cwd(), "packages/runtime-local/src/config.ts");
const { parseLocalRuntimeProfile } = await import(pathToFileURL(configModule).href);
try {
  parseLocalRuntimeProfile(JSON.parse(readFileSync(profilePath, "utf8")), profilePath);
  process.exit(0);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```
注：若上游导出名不同（实现时打开 `packages/runtime-local/src/config.ts` 确认 L222 附近的导出函数名），以实际为准同步改这里。

- [ ] **Step 2: 写失败测试**

`server/test/profile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateProfile } from "../src/validate-profile.js";

const good = {
  format: "hypit.runtime-local@1",
  dataRoot: ".hypit/runtimes/local",
  credentials: { os: { use: "@hypit/credential-store-os" } },
  endpoints: { "media.local": { use: "@hypit/provider-media-local" } },
};

describe("validateProfile（依赖本机 hypit 仓库，慢）", () => {
  it("合法 Profile 通过", async () => {
    expect(await validateProfile(good)).toEqual({ ok: true });
  }, 60_000);
  it("多余顶层键被拒", async () => {
    const bad = { ...good, extra: 1 };
    const res = await validateProfile(bad);
    expect(res.ok).toBe(false);
  }, 60_000);
  it("credentials 条目带 pool 被拒", async () => {
    const bad = structuredClone(good) as Record<string, any>;
    bad.credentials.os.pool = "x";
    expect((await validateProfile(bad)).ok).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd "$WB/server" && pnpm test profile`
Expected: FAIL —— `validate-profile` 不存在。

- [ ] **Step 4: 实现 validateProfile 与路由**

`server/src/validate-profile.ts`:
```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cfg } from "./config.js";

export async function validateProfile(json: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const dir = await mkdtemp(join(tmpdir(), "wb-profile-"));
  const file = join(dir, "hypit.runtime.json");
  await writeFile(file, JSON.stringify(json, null, 2));
  const entry = resolve(import.meta.dirname, "scripts/validate-profile-entry.ts");
  const tsxBin = join(cfg.hypitRepo, "node_modules/.bin/tsx");
  try {
    return await new Promise((res) => {
      execFile(tsxBin, [entry, file], { cwd: cfg.hypitRepo, timeout: 60_000 }, (error, _stdout, stderr) => {
        if (error) res({ ok: false, message: stderr.trim() || error.message });
        else res({ ok: true });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

`server/src/routes/profile.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { cfg } from "../config.js";
import { validateProfile } from "../validate-profile.js";

export async function profilePath(): Promise<string> {
  const pointer = join(cfg.project, ".hypit/runtime");
  if (existsSync(pointer)) {
    const selected = (await readFile(pointer, "utf8")).trim();
    return isAbsolute(selected) ? selected : resolve(cfg.project, selected);
  }
  return join(cfg.project, "hypit.runtime.json");
}

export async function profileRoutes(app: FastifyInstance) {
  app.get("/api/profile", async () => {
    const path = await profilePath();
    return { path, profile: JSON.parse(await readFile(path, "utf8")) };
  });
  app.put<{ Body: { profile: unknown } }>("/api/profile", async (req, reply) => {
    const result = await validateProfile(req.body.profile);
    if (!result.ok) return reply.status(400).send({ error: { code: "E_PROFILE", message: result.message } });
    const path = await profilePath();
    await writeFile(path, JSON.stringify(req.body.profile, null, 2) + "\n");
    return { ok: true, path };
  });
}
```
注：`.hypit/runtime` 指针文件的实际内容格式在实现时用 `cat "$HYPIT_REPO/.hypit/runtime"` 确认（可能是纯路径或 JSON）；若为 JSON，按实际字段取路径并同步修正 `profilePath` 与本注释。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd "$WB/server" && pnpm test profile`
Expected: PASS（3 用例）。

- [ ] **Step 6: 手动往返验证**

起 dev server 后：
`curl -s 127.0.0.1:8090/api/profile | head -c 400`，然后把返回的 profile 原样 PUT 回去：
`curl -s -X PUT -H 'content-type: application/json' -d "{\"profile\": $(curl -s 127.0.0.1:8090/api/profile | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).profile)))')}" 127.0.0.1:8090/api/profile`
Expected: `{"ok":true,...}`，文件内容不变（`git -C "$HYPIT_REPO" status` 无意外改动——注意若 project 指向上游仓库，写的是上游根的 hypit.runtime.json，验证后 `git -C "$HYPIT_REPO" checkout hypit.runtime.json` 还原格式差异）。

- [ ] **Step 7: Commit**

```bash
git add server && git commit -m "feat: Profile 读写 API（上游解析器校验）"
```

---

### Task 5: 凭据 API（auth status / login --from / logout）

**Files:**
- Modify: `server/src/routes/auth.ts`（替换占位）
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Consumes: `runHypit`。
- Produces:
  - `GET /api/auth/:endpoint` → `hypit.cli-auth-status@1` 原样。
  - `POST /api/auth/:endpoint` body=`{ secret: string, slot?: string }` → 写 0600 临时文件，`hypit auth login <endpoint> --from <file> [--slot <slot>]`，finally 删除；返回 `hypit.cli-auth-change@1` 原样。
  - `DELETE /api/auth/:endpoint?slot=` → `hypit auth logout` 原样。
  - `export async function withSecretFile<T>(secret: string, fn: (path: string) => Promise<T>): Promise<T>`（导出便于测试临时文件行为）。

- [ ] **Step 1: 写失败测试**

`server/test/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { withSecretFile } from "../src/routes/auth.js";

describe("withSecretFile", () => {
  it("写入 0600、回调后删除", async () => {
    let seen = "";
    const captured = await withSecretFile("s3cret", async (p) => {
      seen = p;
      const st = await stat(p);
      expect(st.mode & 0o777).toBe(0o600);
      expect(await readFile(p, "utf8")).toBe("s3cret");
      return "done";
    });
    expect(captured).toBe("done");
    expect(existsSync(seen)).toBe(false);
  });
  it("回调抛错也删除", async () => {
    let seen = "";
    await expect(withSecretFile("x", async (p) => { seen = p; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(seen)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd "$WB/server" && pnpm test auth` → FAIL。

- [ ] **Step 3: 实现**

`server/src/routes/auth.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHypit } from "../hypit.js";

export async function withSecretFile<T>(secret: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "wb-secret-"));
  const file = join(dir, "secret");
  await writeFile(file, secret, { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Params: { endpoint: string } }>("/api/auth/:endpoint", async (req) =>
    runHypit(["auth", "status", req.params.endpoint]));
  app.post<{ Params: { endpoint: string }; Body: { secret: string; slot?: string } }>(
    "/api/auth/:endpoint",
    async (req) =>
      withSecretFile(req.body.secret, (file) =>
        runHypit([
          "auth", "login", req.params.endpoint, "--from", file,
          ...(req.body.slot ? ["--slot", req.body.slot] : []),
        ])),
  );
  app.delete<{ Params: { endpoint: string }; Querystring: { slot?: string } }>(
    "/api/auth/:endpoint",
    async (req) =>
      runHypit(["auth", "logout", req.params.endpoint, ...(req.query.slot ? ["--slot", req.query.slot] : [])]),
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd "$WB/server" && pnpm test auth` → PASS。
手动：`curl -s 127.0.0.1:8090/api/auth/hypihub.default` → `hypit.cli-auth-status@1`，`configured: false`。

- [ ] **Step 5: Commit**

```bash
git add server && git commit -m "feat: 凭据 API（auth login --from 临时文件）"
```

---

### Task 6: Studio 启动 API + 产物下载

**Files:**
- Modify: `server/src/routes/studio.ts`（替换占位）, `server/src/routes/builds.ts`（追加产物路由）

**Interfaces:**
- Consumes: `cfg`, `runHypit`。
- Produces:
  - `GET /api/studio` → `{ running: boolean, url?: string, run?: string }`
  - `POST /api/studio` body=`{ run: string }`（`.svrun` 相对 `cfg.project` 的路径）→ 幂等启动子进程 `hypit studio --run <run> --port 5179`；已运行且 run 相同 → 返回现状；run 不同 → 先 kill 再启动。返回 `{ running: true, url: "http://127.0.0.1:5179", run }`。容器内 URL 由前端用 `location.hostname` 拼（见 Task 10），后端只报端口。
  - `DELETE /api/studio` → 停掉子进程 `{ running: false }`
  - `GET /api/builds/:id/outputs/:name` → `hypit get <id> --output <name> --to <tmp>` 后流式返回文件（`content-type: application/octet-stream`，`content-disposition` 带文件名），发送完删除临时文件。

- [ ] **Step 1: 实现 studio 路由**

`server/src/routes/studio.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { cfg } from "../config.js";

let child: ChildProcess | null = null;
let currentRun: string | null = null;

function running() {
  return child != null && child.exitCode == null;
}

export async function studioRoutes(app: FastifyInstance) {
  app.get("/api/studio", async () => ({
    running: running(),
    ...(running() ? { url: "http://127.0.0.1:5179", run: currentRun } : {}),
  }));
  app.post<{ Body: { run: string } }>("/api/studio", async (req) => {
    if (running() && currentRun === req.body.run) return { running: true, url: "http://127.0.0.1:5179", run: currentRun };
    if (running()) { child!.kill(); child = null; }
    child = spawn(cfg.nodeBin, [join(cfg.hypitRepo, "bin/hypit.mjs"), "studio", "--run", req.body.run, "--port", "5179"], {
      cwd: cfg.project,
      stdio: ["ignore", "inherit", "inherit"],
    });
    currentRun = req.body.run;
    child.on("exit", () => { child = null; });
    await new Promise((r) => setTimeout(r, 2500));
    return { running: running(), url: "http://127.0.0.1:5179", run: currentRun };
  });
  app.delete("/api/studio", async () => {
    if (running()) child!.kill();
    child = null;
    return { running: false };
  });
}
```

- [ ] **Step 2: builds.ts 追加产物路由**

在 `buildsRoutes` 内追加：
```ts
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

  app.get<{ Params: { id: string; name: string } }>("/api/builds/:id/outputs/:name", async (req, reply) => {
    const dir = await mkdtemp(join(tmpdir(), "wb-output-"));
    const target = join(dir, req.params.name.replaceAll("/", "_"));
    await runHypit(["get", req.params.id, "--output", req.params.name, "--to", target], { timeoutMs: 300_000 });
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(req.params.name)}"`);
    const stream = createReadStream(target);
    stream.on("close", () => { void rm(dir, { recursive: true, force: true }); });
    return reply.type("application/octet-stream").send(stream);
  });
```

- [ ] **Step 3: 手动验证**

`curl -s 127.0.0.1:8090/api/studio` → `{"running":false}`。（有真实 Build 后再验证 outputs 路由；Task 11 冒烟覆盖。）

- [ ] **Step 4: Commit**

```bash
git add server && git commit -m "feat: Studio 启动 API 与产物下载"
```

---

### Task 7: 前端脚手架 + 设计系统 + API 客户端 + 布局

**Files:**
- Create: `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/styles.css`, `web/src/pages/Dashboard.tsx`（占位）, `web/src/pages/Models.tsx`（占位）, `web/src/pages/Builds.tsx`（占位）, `web/src/pages/Studio.tsx`（占位）

**Interfaces:**
- Consumes: Task 3-6 的 HTTP API。
- Produces:
  - `api.ts`: `export async function api<T>(path: string, init?: RequestInit): Promise<T>`（非 2xx 抛 `Error(error.message)`）；类型 `RuntimeStatus`、`Doctor`、`BuildsList`、`BuildStatus`、`AuthStatus`、`ProfileEnvelope`（按 spec §3 的 machine view 字段声明）。
  - `styles.css` 设计系统类：`.card`、`.btn`、`.btn-primary`、`.badge`、`.badge-ok`、`.badge-warn`、`.badge-err`、`.grid`、`.field`、`.sidebar`、`.page`。
  - `App.tsx`: 左侧栏（logo 区 + 4 个导航）+ `<Outlet/>`，路由 `/`、`/models`、`/builds`、`/studio`。

- [ ] **Step 1: HTML 与入口**

`web/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hypit 工作台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Models from "./pages/Models";
import Builds from "./pages/Builds";
import Studio from "./pages/Studio";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "models", element: <Models /> },
      { path: "builds", element: <Builds /> },
      { path: "studio", element: <Studio /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
```

- [ ] **Step 2: 设计系统 styles.css**

```css
:root {
  --paper: #ffffff;
  --ink: #010101;
  --muted: #6b6b6b;
  --brand: #e83f5f;
  --brand-2: #f1738c;
  --brand-3: #f6a9bd;
  --line: #eaeaea;
  --ok: #14833b;
  --warn: #b45309;
  --err: #c2273c;
  --radius: 10px;
  font-family: -apple-system, "PingFang SC", "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-size: 14px; }
.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 220px; border-right: 1px solid var(--line); padding: 24px 16px;
  display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;
}
.logo { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 24px; }
.logo em {
  font-style: normal;
  background: linear-gradient(90deg, var(--brand), var(--brand-3));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.nav-item {
  display: block; padding: 9px 12px; border-radius: 8px; color: var(--ink);
  text-decoration: none; font-weight: 500;
}
.nav-item:hover { background: #f7f7f7; }
.nav-item.active { background: #fdeef2; color: var(--brand); }
.page { flex: 1; padding: 32px 40px; max-width: 1080px; }
.page h1 { font-size: 26px; letter-spacing: -0.5px; margin: 0 0 4px; }
.page .sub { color: var(--muted); margin: 0 0 28px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.card { border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; background: var(--paper); }
.card h3 { margin: 0 0 4px; font-size: 16px; }
.card .desc { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
.btn {
  border: 1px solid var(--line); background: var(--paper); color: var(--ink);
  border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn:hover { border-color: #d0d0d0; }
.btn-primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn-primary:hover { background: #d63554; }
.btn:disabled { opacity: 0.5; cursor: default; }
.badge {
  display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: #f2f2f2; color: var(--muted);
}
.badge-ok { background: #e7f6ec; color: var(--ok); }
.badge-warn { background: #fdf1e2; color: var(--warn); }
.badge-err { background: #fdecef; color: var(--err); }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field label { font-size: 12px; font-weight: 600; color: var(--muted); }
.field input, .field select {
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13px;
}
.field input:focus { outline: 2px solid var(--brand-3); border-color: var(--brand-2); }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
table.list { width: 100%; border-collapse: collapse; }
table.list th { text-align: left; color: var(--muted); font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
table.list td { padding: 10px; border-bottom: 1px solid var(--line); }
table.list tr:hover td { background: #fafafa; cursor: pointer; }
.error-box { background: #fdecef; color: var(--err); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
pre.logs { background: #0e0e0e; color: #ddd; border-radius: 8px; padding: 14px; overflow: auto; max-height: 320px; font-size: 12px; }
```

- [ ] **Step 3: App 布局与 api 客户端**

`web/src/App.tsx`:
```tsx
import { NavLink, Outlet } from "react-router-dom";

const nav = [
  { to: "/", label: "总览" },
  { to: "/models", label: "模型与服务" },
  { to: "/builds", label: "任务" },
  { to: "/studio", label: "Studio" },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">Hy<em>pit</em> 工作台</div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            {n.label}
          </NavLink>
        ))}
      </aside>
      <main className="page"><Outlet /></main>
    </div>
  );
}
```

`web/src/api.ts`:
```ts
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json()).error?.message ?? message; } catch { /* keep */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type RuntimeStatus = {
  ready: boolean; attention: boolean;
  worker: { state: string };
  builds: { submitting: number; working: number; savingResult: number };
  programs: { total: number; ready: number; unavailable: { id: string; state: string; detail?: string }[] };
  capacity: { active: number };
};
export type Doctor = {
  ok: boolean;
  diagnostics: { severity: "error" | "warning" | "info"; code: string; message: string; subject?: string }[];
};
export type BuildsList = {
  builds: { id: string; createdAt: string; title?: string; outcome: string; run?: string; outputCount: number }[];
  next?: string;
};
export type BuildStatus = {
  build: {
    id: string; title?: string;
    failure?: string;
    work: { state: string; outcome?: string; requests?: { total: number; completed: number } };
    result: { state: string; outputCount?: number };
    attention?: { message: string; action?: string };
    operations?: { endpoint: string; state: string; count?: number; progress?: { phase: string; completed?: number; total?: number } ; failure?: { code: string; message: string } }[];
  } | null;
};
export type AuthStatus = {
  endpoint: string;
  credentials: { slot: string; label: string; kind: string; configured: boolean; writable: boolean }[];
};
export type ProfileEnvelope = { path: string; profile: RuntimeProfile };
export type RuntimeProfile = {
  format: string; dataRoot: string;
  worker?: { executionMemoryMb?: number };
  credentials?: Record<string, { use: string; config?: Record<string, unknown> }>;
  endpoints?: Record<string, { use: string; pool?: string; config?: Record<string, unknown> }>;
  bindings?: Record<string, string>;
};
```

- [ ] **Step 4: 四个页面占位**

每个 `web/src/pages/*.tsx` 先写标题占位（Dashboard 示例，其余同型换标题）：
```tsx
export default function Dashboard() {
  return (<><h1>总览</h1><p className="sub">Runtime 状态与快捷操作</p></>);
}
```

- [ ] **Step 5: 验证 dev 渲染**

Run: `cd "$WB" && pnpm dev:web`，浏览器/`curl -s 127.0.0.1:5173 | head -c 200` 确认返回 HTML；四个导航可切换。
Run: `cd "$WB/web" && pnpm build` → 生成 `web/dist`，无类型错误。

- [ ] **Step 6: Commit**

```bash
git add web && git commit -m "feat: 前端脚手架、设计系统与布局"
```

---

### Task 8: 总览页（Dashboard）

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/runtime/status`、`GET /api/doctor`、`POST /api/runtime/up|down`（api.ts 类型）。

- [ ] **Step 1: 实现页面**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type Doctor, type RuntimeStatus } from "../api";

export default function Dashboard() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [s, d] = await Promise.all([
        api<RuntimeStatus>("/api/runtime/status"),
        api<Doctor>("/api/doctor"),
      ]);
      setStatus(s); setDoctor(d);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = async (dir: "up" | "down") => {
    setBusy(true);
    try { await api(`/api/runtime/${dir}`, { method: "POST" }); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>总览</h1>
      <p className="sub">Runtime 状态与环境诊断</p>
      {error && <div className="error-box">{error}</div>}
      <div className="grid">
        <div className="card">
          <h3>Runtime</h3>
          <p className="desc">本地 Build Worker</p>
          <div className="row">
            {status
              ? <span className={"badge " + (status.ready ? "badge-ok" : "badge-warn")}>
                  {status.ready ? "运行中" : status.worker.state}
                </span>
              : <span className="badge">加载中…</span>}
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => toggle("up")}>启动</button>
            <button className="btn" disabled={busy} onClick={() => toggle("down")}>停止</button>
          </div>
          {status && (
            <p className="desc" style={{ marginTop: 12 }}>
              进行中 {status.builds.working} · 提交中 {status.builds.submitting} · 程序 {status.programs.ready}/{status.programs.total}
            </p>
          )}
        </div>
        <div className="card">
          <h3>诊断</h3>
          <p className="desc">hypit doctor</p>
          {doctor && (
            <>
              <span className={"badge " + (doctor.ok ? "badge-ok" : "badge-err")}>
                {doctor.ok ? "无问题" : `${doctor.diagnostics.filter(d => d.severity === "error").length} 个错误`}
              </span>
              <ul style={{ paddingLeft: 18, marginTop: 10 }}>
                {doctor.diagnostics.slice(0, 5).map((d, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <span className={"badge badge-" + (d.severity === "error" ? "err" : d.severity === "warning" ? "warn" : "ok")}>{d.severity}</span>{" "}
                    {d.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 验证**

server dev + web dev 同跑，浏览器打开 `/`：状态卡显示"运行中"或 worker 状态；诊断卡列出 HypiHub 未登录等条目。

- [ ] **Step 3: Commit**

```bash
git add web && git commit -m "feat: 总览页（状态与诊断）"
```

---

### Task 9: 模型与服务页（Models）

**Files:**
- Modify: `web/src/pages/Models.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/profile`、`GET/POST/DELETE /api/auth/:endpoint`、`GET /api/doctor?endpoint=`。
- 模型能力清单常量（HypiHub 规范名，spec §3）：`seedance-2.5`、`seedance-2-mini`、`seedream-5-lite`、`gpt-image-2`、`nano-banana`、`grok-imagine-video`、`minimax-h3`、`eleven_ttv_v3`、`fishaudio/voice-design-1`、`fishaudio/voice-clone`、`mimo-v2.5-tts-voicedesign`、`mimo-v2.5-tts-voiceclone`、`transcription`。

- [ ] **Step 1: 实现页面**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type AuthStatus, type Doctor, type ProfileEnvelope, type RuntimeProfile } from "../api";

const CAPABILITIES = [
  ["视频", ["seedance-2.5", "seedance-2-mini", "grok-imagine-video", "minimax-h3"]],
  ["图像", ["gpt-image-2", "nano-banana", "seedream-5-lite"]],
  ["语音", ["eleven_ttv_v3", "fishaudio/voice-design-1", "fishaudio/voice-clone", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-tts-voiceclone"]],
  ["转写", ["transcription"]],
] as const;

export default function Models() {
  const [env, setEnv] = useState<ProfileEnvelope | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setEnv(await api<ProfileEnvelope>("/api/profile"));
      setAuth(await api<AuthStatus>("/api/auth/hypihub.default"));
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const profile = env?.profile;
  const hub = profile?.endpoints?.["hypihub.default"];
  const local = profile?.endpoints?.["hyperframes.local"];
  const hubConfigured = auth?.credentials.some((c) => c.configured) ?? false;

  const patch = (endpoint: string, key: string, value: unknown) => {
    if (!env) return;
    const next = structuredClone(env.profile) as RuntimeProfile;
    const ep = next.endpoints?.[endpoint];
    if (!ep) return;
    ep.config = { ...(ep.config ?? {}), [key]: value };
    if (value === "" || value === undefined || Number.isNaN(value)) delete (ep.config as Record<string, unknown>)[key];
    setEnv({ ...env, profile: next });
  };
  const patchCapability = (cap: string, value: number | undefined) => {
    if (!env) return;
    const next = structuredClone(env.profile) as RuntimeProfile;
    const ep = next.endpoints?.["hypihub.default"];
    if (!ep) return;
    const cc = { ...((ep.config?.capabilityConcurrency as Record<string, number>) ?? {}) };
    if (value == null || Number.isNaN(value)) delete cc[cap]; else cc[cap] = value;
    ep.config = { ...(ep.config ?? {}), capabilityConcurrency: cc };
    if (Object.keys(cc).length === 0) delete (ep.config as Record<string, unknown>).capabilityConcurrency;
    setEnv({ ...env, profile: next });
  };

  const save = async () => {
    if (!env) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ profile: env.profile }) });
      setMsg("已保存到 " + env.path + "（重启 Runtime / Studio 后生效）");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const login = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await api("/api/auth/hypihub.default", { method: "POST", body: JSON.stringify({ secret }) });
      setSecret(""); setMsg("HypiHub 凭据已保存"); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const test = async (endpoint: string) => {
    setBusy(true); setError(""); setMsg("");
    try {
      const d = await api<Doctor>(`/api/doctor?endpoint=${encodeURIComponent(endpoint)}`);
      setMsg(d.ok ? `${endpoint}：连通正常` : `${endpoint}：` + d.diagnostics.map((x) => x.message).join("；"));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const cc = (hub?.config?.capabilityConcurrency as Record<string, number> | undefined) ?? {};

  return (
    <>
      <h1>模型与服务</h1>
      <p className="sub">所有生成模型经 HypiHub 网关执行；本地渲染与转写在本机运行。保存写回 {env?.path ?? "…"}</p>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      <div className="grid">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="row">
            <h3>HypiHub 网关</h3>
            <span className={"badge " + (hubConfigured ? "badge-ok" : "badge-warn")}>{hubConfigured ? "已连接" : "未配置凭据"}</span>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => test("hypihub.default")}>测试连通</button>
          </div>
          <p className="desc">Seedance / Seedream / GPT Image / Nano Banana / Grok / MiniMax / 语音 / 转写</p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 2 }}>
              <label>API Key（粘贴后保存，不回显）</label>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="hypihub API key" />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn btn-primary" disabled={busy || !secret} onClick={login}>保存凭据</button>
            </div>
            <div className="field">
              <label>总并发 defaultConcurrency</label>
              <input value={num(hub?.config?.defaultConcurrency)} onChange={(e) => patch("hypihub.default", "defaultConcurrency", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
          {CAPABILITIES.map(([group, caps]) => (
            <div key={group}>
              <p className="desc" style={{ margin: "10px 0 6px" }}>{group} · 每模型并发上限（留空 = 跟随总并发）</p>
              <div className="row">
                {caps.map((cap) => (
                  <div className="field" key={cap} style={{ minWidth: 180 }}>
                    <label>{cap}</label>
                    <input value={cc[cap] != null ? String(cc[cap]) : ""}
                      onChange={(e) => patchCapability(cap, e.target.value === "" ? undefined : Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="row">
            <h3>本地渲染</h3>
            <span className="badge badge-ok">hyperframes.local</span>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => test("hyperframes.local")}>测试</button>
          </div>
          <p className="desc">HyperFrames 视频合成（Chromium + ffmpeg）</p>
          <div className="field"><label>并行 worker 数</label>
            <input value={num(local?.config?.workers)} onChange={(e) => patch("hyperframes.local", "workers", e.target.value === "" ? "" : Number(e.target.value))} /></div>
          <div className="field"><label>渲染并发 defaultConcurrency</label>
            <input value={num(local?.config?.defaultConcurrency)} onChange={(e) => patch("hyperframes.local", "defaultConcurrency", e.target.value === "" ? "" : Number(e.target.value))} /></div>
          <div className="field"><label>GPU 模式 browserGpu</label>
            <select value={String(local?.config?.browserGpu ?? "hardware")} onChange={(e) => patch("hyperframes.local", "browserGpu", e.target.value)}>
              <option value="hardware">hardware</option><option value="software">software</option><option value="auto">auto</option>
            </select></div>
          {typeof local?.config?.chromePath === "string" && (
            <p className="desc">浏览器：{String(local.config.chromePath)}（容器内固定）</p>)}
        </div>
        <div className="card">
          <div className="row"><h3>本地媒体</h3><span className="badge badge-ok">media.local</span>
            <span className="spacer" /><button className="btn" disabled={busy} onClick={() => test("media.local")}>测试</button></div>
          <p className="desc">音频时间线渲染与封装（ffmpeg）；无需配置。</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 20 }}>
        <span className="spacer" />
        <button className="btn" onClick={() => void load()}>放弃修改</button>
        <button className="btn btn-primary" disabled={busy || !env} onClick={save}>保存配置</button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 验证往返**

浏览器 `/models`：改 `defaultConcurrency` → 保存 → 提示成功；`cat` Profile 文件确认写入；填一个非法值（如 workers 填 `-1` 或把 format 破坏）应弹出上游校验错误且文件未变。验证完把 Profile 还原。

- [ ] **Step 3: Commit**

```bash
git add web && git commit -m "feat: 模型与服务配置页"
```

---

### Task 10: 任务面板 + Studio 页

**Files:**
- Modify: `web/src/pages/Builds.tsx`, `web/src/pages/Studio.tsx`

**Interfaces:**
- Consumes: `GET /api/builds`、`GET /api/builds/:id`、`GET /api/builds/:id/logs`、`GET /api/builds/:id/outputs/:name`、`GET/POST /api/studio`。

- [ ] **Step 1: Builds 页**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type BuildStatus, type BuildsList } from "../api";

export default function Builds() {
  const [list, setList] = useState<BuildsList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BuildStatus["build"]>(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (before?: string) => {
    try {
      setError("");
      const page = await api<BuildsList>("/api/builds?limit=20" + (before ? `&before=${before}` : ""));
      setList((prev) => before && prev ? { builds: [...prev.builds, ...page.builds], next: page.next } : page);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api<BuildStatus>(`/api/builds/${selected}`);
        if (stop) return;
        setDetail(s.build);
        const l = await api<{ lines?: string[] }>(`/api/builds/${selected}/logs?lines=80`);
        if (!stop) setLogs(Array.isArray(l.lines) ? l.lines.join("\n") : JSON.stringify(l, null, 2));
        if (s.build && s.build.work.state !== "done") setTimeout(tick, 3000);
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void tick();
    return () => { stop = true; };
  }, [selected]);

  return (
    <>
      <h1>任务</h1>
      <p className="sub">Build 历史与实时进度</p>
      {error && <div className="error-box">{error}</div>}
      <table className="list">
        <thead><tr><th>ID</th><th>标题</th><th>状态</th><th>创建时间</th><th>产物</th></tr></thead>
        <tbody>
          {list?.builds.map((b) => (
            <tr key={b.id} onClick={() => setSelected(b.id)}>
              <td style={{ fontFamily: "monospace" }}>{b.id.slice(0, 12)}</td>
              <td>{b.title ?? b.run ?? "—"}</td>
              <td><span className={"badge " + (b.outcome === "complete" ? "badge-ok" : b.outcome === "failed" ? "badge-err" : "badge-warn")}>{b.outcome}</span></td>
              <td>{new Date(b.createdAt).toLocaleString("zh-CN")}</td>
              <td>{b.outputCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list?.next && <button className="btn" style={{ marginTop: 12 }} onClick={() => void load(list.next)}>加载更多</button>}
      {list && list.builds.length === 0 && <p className="sub">还没有 Build。用你的 Agent 提交一个试试。</p>}
      {selected && detail && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="row">
            <h3>{detail.title ?? detail.id}</h3>
            <span className="badge">{detail.work.state}{detail.work.outcome ? ` · ${detail.work.outcome}` : ""}</span>
            {detail.work.requests && <span className="desc">{detail.work.requests.completed}/{detail.work.requests.total} 请求</span>}
            <span className="spacer" />
            {detail.result.state === "complete" && detail.result.outputCount != null && (
              <span className="badge badge-ok">{detail.result.outputCount} 个产物（用 hypit get 或产物链接下载）</span>)}
          </div>
          {detail.attention && <div className="error-box">{detail.attention.message}</div>}
          {detail.failure && <div className="error-box">{detail.failure}</div>}
          {detail.operations && detail.operations.length > 0 && (
            <ul style={{ paddingLeft: 18 }}>
              {detail.operations.map((op, i) => (
                <li key={i}>{op.endpoint} · {op.state}
                  {op.progress ? ` · ${op.progress.phase} ${op.progress.completed ?? ""}${op.progress.total ? "/" + op.progress.total : ""}` : ""}
                  {op.failure ? ` · ${op.failure.message}` : ""}{op.count ? ` ×${op.count}` : ""}</li>
              ))}
            </ul>
          )}
          <pre className="logs">{logs || "（暂无日志）"}</pre>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Studio 页**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api";

type StudioState = { running: boolean; url?: string; run?: string };

export default function Studio() {
  const [state, setState] = useState<StudioState | null>(null);
  const [run, setRun] = useState("build.svrun");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => setState(await api<StudioState>("/api/studio"));
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, []);

  const studioHref = `http://${location.hostname}:5179/`;

  const start = async () => {
    setBusy(true); setError("");
    try {
      const s = await api<StudioState>("/api/studio", { method: "POST", body: JSON.stringify({ run }) });
      setState(s);
      if (s.running) window.open(studioHref, "_blank");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>Studio</h1>
      <p className="sub">官方可视化编辑器（端口 5179）</p>
      {error && <div className="error-box">{error}</div>}
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>Run 源（相对项目目录的 .svrun 路径）</label>
          <input value={run} onChange={(e) => setRun(e.target.value)} placeholder="build.svrun" />
        </div>
        <div className="row">
          {state?.running
            ? <span className="badge badge-ok">运行中 · {state.run}</span>
            : <span className="badge">未运行</span>}
          <span className="spacer" />
          {state?.running && <a className="btn" href={studioHref} target="_blank" rel="noreferrer">打开 Studio</a>}
          {state?.running && <button className="btn" disabled={busy}
            onClick={() => { void api("/api/studio", { method: "DELETE" }).then(refresh); }}>停止</button>}
          <button className="btn btn-primary" disabled={busy || !run} onClick={start}>
            {state?.running ? "切换 Run 并重启" : "启动 Studio"}
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: 验证**

- `/builds`：能列出此前 `hypit builds` 中的历史（若空则显示空态文案）。
- `/studio`：无有效 `.svrun` 时启动会失败——确认错误被 error-box 呈现且不崩页。
- `cd "$WB/web" && pnpm build` 通过。

- [ ] **Step 4: Commit**

```bash
git add web && git commit -m "feat: 任务面板与 Studio 页"
```

---

### Task 11: Docker 化 + 冒烟脚本 + README

**Files:**
- Create: `docker/Dockerfile`, `docker/docker-compose.yml`, `docker/entrypoint-runtime.sh`, `docker/entrypoint-workbench.sh`, `docker/runtime.docker.json`, `docker/smoke.sh`, `README.md`

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: `cd docker && docker compose up -d` 后，`127.0.0.1:8090` 工作台可用、`127.0.0.1:5179` Studio 可转发。

- [ ] **Step 1: Dockerfile**

```dockerfile
# 构建上下文 = 仓库父目录（hpyit爆款视频复刻/），见 compose 的 context: ..
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg python3 socat curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
# uv（WhisperX 等 Managed Program 需要；官方安装脚本）
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
# Docker 内默认 seccomp 禁用户命名空间，chromium 需 --no-sandbox 包装
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/chromium-nosandbox \
    && chmod +x /usr/local/bin/chromium-nosandbox

RUN corepack enable
WORKDIR /opt/hypit
COPY hypit/ ./
RUN pnpm install --frozen-lockfile

WORKDIR /opt/workbench
COPY hypit-workbench/package.json hypit-workbench/pnpm-workspace.yaml ./
COPY hypit-workbench/server/package.json server/
COPY hypit-workbench/web/package.json web/
RUN pnpm install
COPY hypit-workbench/server/ server/
COPY hypit-workbench/web/ web/
RUN pnpm --filter @workbench/web build

COPY hypit-workbench/docker/entrypoint-runtime.sh /usr/local/bin/entrypoint-runtime.sh
COPY hypit-workbench/docker/entrypoint-workbench.sh /usr/local/bin/entrypoint-workbench.sh
COPY hypit-workbench/docker/runtime.docker.json /opt/runtime.docker.json
RUN chmod +x /usr/local/bin/entrypoint-*.sh && chown -R node:node /opt

USER node
ENV HYPIT_REPO=/opt/hypit HYPIT_PROJECT=/projects/default
```

- [ ] **Step 2: entrypoint 脚本与容器 Profile**

`docker/runtime.docker.json`:
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
      "config": {
        "baseUrl": "https://hypit.ai",
        "apiKey": { "store": "file", "key": "hypihub.oauth" },
        "defaultConcurrency": 3
      }
    },
    "media.local": { "use": "@hypit/provider-media-local" },
    "hyperframes.local": {
      "use": "@hypit/provider-hyperframes-local",
      "config": {
        "chromePath": "/usr/local/bin/chromium-nosandbox",
        "browserGpu": "software",
        "workers": 2,
        "maxWorkers": 4,
        "defaultConcurrency": 1
      }
    }
  }
}
```

`docker/entrypoint-runtime.sh`:
```bash
#!/bin/bash
set -euo pipefail
mkdir -p /projects/default
cd /projects/default
if [ ! -f hypit.runtime.json ]; then cp /opt/runtime.docker.json hypit.runtime.json; fi
node /opt/hypit/bin/hypit.mjs runtime use hypit.runtime.json
node /opt/hypit/bin/hypit.mjs runtime up
echo "Runtime worker ready; tailing"
exec tail -f /dev/null
```

`docker/entrypoint-workbench.sh`:
```bash
#!/bin/bash
set -euo pipefail
mkdir -p /projects/default
cd /projects/default
if [ ! -f hypit.runtime.json ]; then cp /opt/runtime.docker.json hypit.runtime.json; fi
node /opt/hypit/bin/hypit.mjs runtime use hypit.runtime.json || true
# Studio 只监听 127.0.0.1，转发到 0.0.0.0:5179 供宿主访问（Studio 实际用 5180 内部端口）
socat TCP-LISTEN:5179,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:5180 &
cd /opt/workbench
exec node server/node_modules/.bin/tsx server/src/index.ts
```
注意：因 socat 占用 5179 对外，Studio 子进程实际端口应为 5180 —— 实现本任务时把 Task 6 `studio.ts` 中的 `"5179"` 改为读环境变量 `STUDIO_PORT ?? "5179"`，compose 给 workbench 设 `STUDIO_PORT=5180`；本机非 Docker 场景保持 5179 直连。前端 `studioHref` 端口同样从 `GET /api/studio` 返回的 `port` 字段取（`studio.ts` 返回值增加 `port: Number(process.env.STUDIO_PORT ?? 5179)`，Docker 前端拼 `http://${location.hostname}:5179/` 时用宿主映射端口 5179 —— socat 已把 5179 转给内部 5180，故前端固定 5179 即可，仅后端 spawn 端口需可配）。

- [ ] **Step 3: docker-compose.yml**

```yaml
services:
  runtime:
    build:
      context: ..
      dockerfile: hypit-workbench/docker/Dockerfile
    image: hypit-workbench:latest
    entrypoint: /usr/local/bin/entrypoint-runtime.sh
    volumes:
      - ../projects:/projects
      - hypit-home:/home/node
    restart: unless-stopped

  workbench:
    image: hypit-workbench:latest
    depends_on: [runtime]
    entrypoint: /usr/local/bin/entrypoint-workbench.sh
    environment:
      - STUDIO_PORT=5180
    volumes:
      - ../projects:/projects
      - hypit-home:/home/node
    ports:
      - "127.0.0.1:8090:8090"
      - "127.0.0.1:5179:5179"
    restart: unless-stopped

volumes:
  hypit-home:
```

- [ ] **Step 4: 冒烟脚本**

`docker/smoke.sh`:
```bash
#!/bin/bash
set -euo pipefail
base=http://127.0.0.1:8090
for path in /api/health /api/runtime/status /api/doctor /api/builds /api/profile /api/studio; do
  echo "== GET $path"
  curl -fsS "$base$path" | head -c 300; echo
done
echo "SMOKE OK"
```

- [ ] **Step 5: 构建与验证**

```bash
cd "$WB/docker" && docker compose build && docker compose up -d
sleep 20 && bash smoke.sh
docker compose exec runtime node /opt/hypit/bin/hypit.mjs doctor --json
```
Expected: smoke 全绿；doctor 里浏览器诊断显示 chromium-nosandbox 路径；唯一 error 是 HypiHub 未登录（预期，在工作台页面填 Key 后消失）。浏览器打开 `http://127.0.0.1:8090` 走一遍四个页面。

- [ ] **Step 6: README.md**

内容（中文）：项目简介；架构图（compose 两服务 + 卷）；快速开始（Docker：`cd docker && docker compose up -d --build` → 打开 127.0.0.1:8090；本机开发：nvm use 22 + pnpm install + 两个 dev 命令）；环境变量表（HYPIT_REPO/HYPIT_PROJECT/PORT/STUDIO_PORT）；模型配置说明（全部经 HypiHub，在"模型与服务"页填 Key）；已知限制（Apple Silicon 软件渲染较慢、Studio 经 socat 转发、凭据 file store 为明文卷）；目录结构。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Docker 部署、冒烟脚本与 README"
```

---

## Self-Review 结果

- **Spec 覆盖**：§4.1 Docker → Task 11；§4.2 后端六组路由 → Task 3/4/5/6；§4.3 四页面 → Task 7-10；§5 错误处理 → Task 2 的 HypitCliError + Task 3 errorHandler + 各页 error-box；§6 测试 → Task 2/4/5 单测 + Task 11 smoke。视觉 token 与中文界面 → Task 7。
- **占位符**：无 TBD；两处"以实际为准"注记（上游导出名、`.hypit/runtime` 指针格式）是实现时的验证指令而非缺口，均给出确认命令。
- **类型一致性**：`runHypit`/`HypitCliError`/`withSecretFile`/`validateProfile`/api.ts 类型在消费方与定义方签名一致；Task 11 对 Task 6 的 `STUDIO_PORT` 修改已在 Task 11 内写明具体改法。
