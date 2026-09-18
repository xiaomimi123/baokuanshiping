import type { FastifyInstance } from "fastify";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, sep } from "node:path";
import { HypitCliError, runHypit } from "../hypit.js";
import { TEMPLATES, isTranscribeAvailable } from "../templates.js";
import { applyVariables, assertSlug, createProject, listProjects, projectDir, readMeta, writeMeta } from "../projects.js";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 素材文件名 slug 化：小写字母/数字，其余替换为 `-`，保留原扩展名；空名兜底为 "asset"。 */
function slugifyFilename(original: string): string {
  const ext = extname(original).toLowerCase();
  const stem = basename(original, extname(original));
  const base = stem
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "asset"}${ext}`;
}

async function listUploads(name: string): Promise<{ file: string; size: number; type: string }[]> {
  const dir = join(projectDir(name), "assets/uploads");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: { file: string; size: number; type: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const st = await stat(join(dir, entry.name));
    files.push({ file: entry.name, size: st.size, type: MIME[extname(entry.name).toLowerCase()] ?? "application/octet-stream" });
  }
  return files;
}

export async function projectsRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => ({ projects: await listProjects() }));

  app.post<{ Body: { template: string; title: string } }>("/api/projects", async (req, reply) => {
    const body = req.body ?? ({} as { template: string; title: string });
    const template = TEMPLATES.find((t) => t.id === body.template);
    if (!template) {
      return reply.status(404).send({ error: { code: "E_TEMPLATE_NOT_FOUND", message: `未知模板：${body.template}` } });
    }
    const result = await createProject(template, body.title);
    const meta = await readMeta(result.name);
    return { name: result.name, warnings: result.warnings, ...meta };
  });

  app.get<{ Params: { name: string } }>("/api/projects/:name", async (req, reply) => {
    try {
      const meta = await readMeta(req.params.name);
      const assets = await listUploads(req.params.name);
      return { name: req.params.name, ...meta, assets };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
      }
      throw err;
    }
  });

  app.post<{ Params: { name: string } }>("/api/projects/:name/assets", async (req, reply) => {
    try {
      await readMeta(req.params.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
      }
      throw err;
    }

    const uploadsDir = join(projectDir(req.params.name), "assets/uploads");
    await mkdir(uploadsDir, { recursive: true });

    const saved: string[] = [];
    const rejected: string[] = [];
    for await (const part of req.files()) {
      const ext = extname(part.filename).toLowerCase();
      const expectedMime = MIME[ext];
      // 基础防护：扩展名合法只是第一道关卡，还要求浏览器/客户端申报的 mimetype 大类（video/audio/image）
      // 与扩展名对应的大类一致，防止把 .png 之类的白名单扩展名套在任意二进制内容上蒙混过关。
      const expectedCategory = expectedMime ? `${expectedMime.split("/")[0]}/` : undefined;
      if (!expectedMime || !part.mimetype.startsWith(expectedCategory!)) {
        rejected.push(part.filename);
        part.file.resume(); // 丢弃流内容，避免请求挂起
        continue;
      }
      const filename = slugifyFilename(part.filename);
      const dest = join(uploadsDir, filename);
      await pipeline(part.file, createWriteStream(dest)); // 同名覆盖
      saved.push(filename);
    }

    if (saved.length === 0) {
      return reply.status(400).send({
        error: {
          code: "E_NO_VALID_FILE",
          message: rejected.length > 0 ? `文件类型不受支持：${rejected.join(", ")}` : "未收到任何文件",
        },
      });
    }

    return { saved, rejected, assets: await listUploads(req.params.name) };
  });

  app.delete<{ Params: { name: string; file: string } }>("/api/projects/:name/assets/:file", async (req, reply) => {
    try {
      await readMeta(req.params.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
      }
      throw err;
    }

    assertSlug(req.params.file);
    const uploadsDir = join(projectDir(req.params.name), "assets/uploads");
    const target = join(uploadsDir, req.params.file);
    if (!target.startsWith(uploadsDir + sep) || !existsSync(target)) {
      return reply.status(404).send({ error: { code: "E_ASSET_NOT_FOUND", message: `素材不存在：${req.params.file}` } });
    }
    await unlink(target);
    return { assets: await listUploads(req.params.name) };
  });

  app.put<{ Params: { name: string }; Body: { values?: Record<string, string> } }>(
    "/api/projects/:name/variables",
    async (req, reply) => {
      let meta;
      try {
        meta = await readMeta(req.params.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
        }
        throw err;
      }

      const template = TEMPLATES.find((t) => t.id === meta.template);
      if (!template) {
        return reply.status(404).send({ error: { code: "E_TEMPLATE_NOT_FOUND", message: `未知模板：${meta.template}` } });
      }

      const values = req.body?.values ?? {};
      await applyVariables(req.params.name, template.variables, values);

      const updated = await readMeta(req.params.name);
      const assets = await listUploads(req.params.name);
      return { name: req.params.name, ...updated, assets };
    },
  );

  app.post<{ Params: { name: string }; Body: { asset?: string; language?: string } }>(
    "/api/projects/:name/transcribe",
    async (req, reply) => {
      try {
        await readMeta(req.params.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
        }
        throw err;
      }

      const assetName = req.body?.asset;
      if (typeof assetName !== "string" || assetName.length === 0) {
        return reply.status(400).send({ error: { code: "E_BAD_ASSET", message: "asset 必须是素材文件名字符串" } });
      }
      assertSlug(assetName); // 同 assets 路由：拒绝越界/非法文件名
      const uploadsDir = join(projectDir(req.params.name), "assets/uploads");
      const assetPath = join(uploadsDir, assetName);
      if (!assetPath.startsWith(uploadsDir + sep) || !existsSync(assetPath)) {
        return reply.status(404).send({ error: { code: "E_ASSET_NOT_FOUND", message: `素材不存在：${assetName}` } });
      }

      // 纯读 Profile 判断转写能力（与 templateAvailability 同源逻辑），不跑 doctor。
      if (!(await isTranscribeAvailable())) {
        return reply.status(409).send({
          error: {
            code: "E_NO_TRANSCRIBER",
            message: "尚未配置语音转写（WhisperX）服务，请先前往「模型」页配置对应 Endpoint 后再试",
          },
        });
      }

      // hypit transcribe 要求显式语言码（无 auto），且 --to 目标文件不能预先存在；
      // 用一次性临时目录接住输出，读出全部段落文本后立即清理，不在项目内留痕。
      const language = typeof req.body?.language === "string" && req.body.language.length > 0 ? req.body.language : "zh";
      const scratch = await mkdtemp(join(tmpdir(), "workbench-transcribe-"));
      const to = join(scratch, "transcript.json");
      try {
        await runHypit(["transcribe", assetPath, "--to", to, "--language", language], {
          cwd: projectDir(req.params.name),
          timeoutMs: 600_000,
        });
        const transcript = JSON.parse(await readFile(to, "utf8")) as { passages?: { text?: string }[] };
        const text = (transcript.passages ?? []).map((p) => p.text ?? "").join("\n");
        return { text };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );

  app.post<{ Params: { name: string } }>("/api/projects/:name/build", async (req, reply) => {
    let meta;
    try {
      meta = await readMeta(req.params.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.status(404).send({ error: { code: "E_NOT_FOUND", message: `项目不存在：${req.params.name}` } });
      }
      throw err;
    }

    let result: Record<string, unknown>;
    try {
      result = await runHypit(["build", meta.runSource], { cwd: projectDir(req.params.name), timeoutMs: 120_000 });
    } catch (err) {
      if (err instanceof HypitCliError) {
        // Runtime 未就绪（Worker 未起/程序不可用）时 CLI 报错信息含 "Runtime" 关键字，附中文引导后原样透传（全局
        // 错误处理器把 HypitCliError 映射为 502）。
        const hint = /runtime/i.test(err.message) ? "；请先在总览页启动 Runtime" : "";
        throw new HypitCliError(err.code, `${err.message}${hint}`, err.detail);
      }
      throw err;
    }

    const buildId = (result.build as { id?: unknown } | undefined)?.id;
    if (typeof buildId !== "string") {
      throw new HypitCliError("E_PARSE", "hypit build 输出缺少 build.id 字段", result);
    }

    await writeMeta(req.params.name, { ...meta, builds: [...meta.builds, buildId] });
    return { buildId };
  });
}
