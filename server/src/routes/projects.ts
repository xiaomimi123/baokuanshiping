import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { TEMPLATES } from "../templates.js";
import { createProject, listProjects, projectDir, readMeta } from "../projects.js";

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
}
