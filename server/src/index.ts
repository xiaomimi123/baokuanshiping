import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { HypitCliError } from "./hypit.js";
import { ProjectError } from "./projects.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { buildsRoutes } from "./routes/builds.js";
import { profileRoutes } from "./routes/profile.js";
import { authRoutes } from "./routes/auth.js";
import { studioRoutes } from "./routes/studio.js";
import { templatesRoutes } from "./routes/templates.js";
import { projectsRoutes } from "./routes/projects.js";

/** 4xx 客户端错误的最小结构判断（不要求是某个具体错误类，@fastify/multipart 等第三方插件的错误也适用）。 */
function isClientError(error: unknown): error is Error & { statusCode: number; code?: string } {
  if (!(error instanceof Error)) return false;
  const statusCode = (error as unknown as Record<string, unknown>).statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

export function buildServer() {
  const app = Fastify({ logger: true });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HypitCliError) {
      reply.status(502).send({ error: { code: error.code, message: error.message } });
    } else if (error instanceof ProjectError) {
      reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    } else if (isClientError(error)) {
      // 4xx 透传：例如 @fastify/multipart 超出 fileSize 限制时抛的 FST_REQ_FILE_TOO_LARGE（413）——
      // 之前落到 else 分支被错误地包成 500，掩盖了真实的客户端错误语义（I4）。
      reply.status(error.statusCode).send({ error: { code: error.code ?? "E_REQUEST", message: error.message } });
    } else {
      app.log.error(error);
      const message = error instanceof Error ? error.message : String(error);
      reply.status(500).send({ error: { code: "E_INTERNAL", message } });
    }
  });
  // 512MB 上限：仅对使用 multipart 的路由（POST /api/projects/:name/assets）生效，其余路由不解析 multipart。
  app.register(fastifyMultipart, { limits: { fileSize: 512 * 1024 * 1024 } });
  app.register(runtimeRoutes);
  app.register(buildsRoutes);
  app.register(profileRoutes);
  app.register(authRoutes);
  app.register(studioRoutes);
  app.register(templatesRoutes);
  app.register(projectsRoutes);
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
