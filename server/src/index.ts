import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { HypitCliError } from "./hypit.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { buildsRoutes } from "./routes/builds.js";
import { profileRoutes } from "./routes/profile.js";
import { authRoutes } from "./routes/auth.js";
import { studioRoutes } from "./routes/studio.js";
import { templatesRoutes } from "./routes/templates.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HypitCliError) {
      reply.status(502).send({ error: { code: error.code, message: error.message } });
    } else {
      app.log.error(error);
      const message = error instanceof Error ? error.message : String(error);
      reply.status(500).send({ error: { code: "E_INTERNAL", message } });
    }
  });
  app.register(runtimeRoutes);
  app.register(buildsRoutes);
  app.register(profileRoutes);
  app.register(authRoutes);
  app.register(studioRoutes);
  app.register(templatesRoutes);
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
  mkdirSync(cfg.project, { recursive: true });
  buildServer().listen({ port: cfg.port, host: cfg.host });
}
