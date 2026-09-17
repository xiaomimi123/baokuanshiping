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
