import type { FastifyInstance } from "fastify";
import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, dirname, resolve } from "node:path";
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
  app.get("/api/profile", async (_req, reply) => {
    const path = await profilePath();
    if (!existsSync(path)) {
      return reply.status(404).send({
        error: { code: "E_NO_PROFILE", message: "未找到 Runtime Profile，请先运行 hypit runtime init 或在 Docker 中启动" },
      });
    }
    return { path, profile: JSON.parse(await readFile(path, "utf8")) };
  });
  app.put<{ Body: { profile: unknown } }>("/api/profile", async (req, reply) => {
    const result = await validateProfile(req.body.profile);
    if (!result.ok) return reply.status(400).send({ error: { code: "E_PROFILE", message: result.message } });
    const path = await profilePath();
    const tmpPath = join(dirname(path), `.${join(path).split("/").pop()}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(req.body.profile, null, 2) + "\n");
    await rename(tmpPath, path);
    return { ok: true, path };
  });
}
