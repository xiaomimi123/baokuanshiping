import type { FastifyInstance } from "fastify";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { basename, extname, join, sep } from "node:path";
import { TEMPLATES } from "../templates.js";
import { applyVariables, assertSlug, createProject, listProjects, projectDir, readMeta } from "../projects.js";

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
}
