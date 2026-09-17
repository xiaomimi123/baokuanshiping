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
