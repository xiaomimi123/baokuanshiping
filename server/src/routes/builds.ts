import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  app.get<{ Params: { id: string; name: string } }>("/api/builds/:id/outputs/:name", async (req, reply) => {
    const dir = await mkdtemp(join(tmpdir(), "wb-output-"));
    const target = join(dir, req.params.name.replaceAll("/", "_"));
    await runHypit(["get", req.params.id, "--output", req.params.name, "--to", target], { timeoutMs: 300_000 });
    reply.header("content-disposition", `attachment; filename="${encodeURIComponent(req.params.name)}"`);
    const stream = createReadStream(target);
    stream.on("close", () => { void rm(dir, { recursive: true, force: true }); });
    return reply.type("application/octet-stream").send(stream);
  });
}
