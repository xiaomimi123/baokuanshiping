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
