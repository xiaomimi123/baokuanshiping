import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHypit } from "../hypit.js";
import { projectDir, readMeta } from "../projects.js";

function sanitizeOutputName(name: string): string {
  const replaced = name.replaceAll("/", "_");
  return replaced === "." || replaced === ".." || replaced === "" ? "_" : replaced;
}

/**
 * `?project=<name>` 可选：把 runHypit 的 cwd 从默认项目换成该创作项目目录，让 Build 查询落在提交它的项目
 * 自己的本地结果仓库里（hypit 的 Build 结果按提交时的项目根存储，不是全局的）。`projectDir` 内部已做
 * slug 校验 + 越界拒绝；额外用 `readMeta` 确认目录确有 `.workbench.json`（真实创作项目），不存在 → 404。
 * 不传 `project` 时行为与之前完全一致（cwd 用 cfg.project，即共享 default 项目）。
 */
export async function resolveBuildCwd(project: string | undefined): Promise<string | undefined> {
  if (project === undefined || project.length === 0) return undefined;
  await readMeta(project); // 校验 slug + 越界（projectDir 内部）+ 项目存在（.workbench.json 可读）
  return projectDir(project);
}

export async function buildsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; before?: string; project?: string } }>("/api/builds", async (req, reply) => {
    let cwd: string | undefined;
    try {
      cwd = await resolveBuildCwd(req.query.project);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.query.project}` } });
      }
      throw err;
    }
    const args = ["builds"];
    if (req.query.limit) args.push("--limit", req.query.limit);
    if (req.query.before) args.push("--before", req.query.before);
    return runHypit(args, { cwd });
  });
  app.get<{ Params: { id: string }; Querystring: { project?: string } }>("/api/builds/:id", async (req, reply) => {
    let cwd: string | undefined;
    try {
      cwd = await resolveBuildCwd(req.query.project);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.query.project}` } });
      }
      throw err;
    }
    return runHypit(["status", req.params.id], { cwd });
  });
  app.get<{ Params: { id: string }; Querystring: { lines?: string; project?: string } }>(
    "/api/builds/:id/logs",
    async (req, reply) => {
      let cwd: string | undefined;
      try {
        cwd = await resolveBuildCwd(req.query.project);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.query.project}` } });
        }
        throw err;
      }
      return runHypit(["logs", req.params.id, "--lines", req.query.lines ?? "200"], { cwd });
    },
  );

  // `hypit inspect <id> --json` 透传：GET /api/builds/:id 走的 `hypit status` 不含产物名/MIME
  // （CliBuildStatusView.result 只有 outputCount），核对 packages/cli/src/view.ts 后确认要拿
  // 产物清单（name/mediaType/kind）必须用 `hypit inspect`（CliBuildResultView.outputs）另开一路由。
  app.get<{ Params: { id: string }; Querystring: { project?: string } }>(
    "/api/builds/:id/outputs",
    async (req, reply) => {
      let cwd: string | undefined;
      try {
        cwd = await resolveBuildCwd(req.query.project);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.query.project}` } });
        }
        throw err;
      }
      return runHypit(["inspect", req.params.id, "--verbose"], { cwd });
    },
  );

  app.get<{ Params: { id: string; name: string }; Querystring: { project?: string } }>(
    "/api/builds/:id/outputs/:name",
    async (req, reply) => {
      let cwd: string | undefined;
      try {
        cwd = await resolveBuildCwd(req.query.project);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.query.project}` } });
        }
        throw err;
      }
      const dir = await mkdtemp(join(tmpdir(), "wb-output-"));
      const safeName = sanitizeOutputName(req.params.name);
      const target = join(dir, safeName);
      try {
        await runHypit(["get", req.params.id, "--output", req.params.name, "--to", target], { cwd, timeoutMs: 300_000 });
        const st = await stat(target);
        if (st.isDirectory()) {
          await rm(dir, { recursive: true, force: true });
          return reply.status(502).send({
            error: { code: "E_COMPOSITE_OUTPUT", message: "该产物为复合目录，暂不支持网页下载，请用 hypit get 导出" },
          });
        }
      } catch (err) {
        await rm(dir, { recursive: true, force: true });
        throw err;
      }
      reply.header("content-disposition", `attachment; filename="${encodeURIComponent(req.params.name)}"`);
      const stream = createReadStream(target);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        void rm(dir, { recursive: true, force: true });
      };
      stream.on("close", cleanup);
      stream.on("error", cleanup);
      return reply.type("application/octet-stream").send(stream);
    },
  );
}
