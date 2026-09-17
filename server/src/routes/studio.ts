import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { cfg } from "../config.js";

let child: ChildProcess | null = null;
let currentRun: string | null = null;

const port = process.env.STUDIO_PORT ?? "5179";

function running() {
  return child != null && child.exitCode == null;
}

export async function studioRoutes(app: FastifyInstance) {
  app.get("/api/studio", async () => ({
    running: running(),
    ...(running() ? { url: `http://127.0.0.1:${port}`, run: currentRun } : {}),
  }));
  app.post<{ Body: { run: string } }>("/api/studio", async (req) => {
    if (running() && currentRun === req.body.run) return { running: true, url: `http://127.0.0.1:${port}`, run: currentRun };
    if (running()) {
      const old = child!;
      old.on("exit", () => { if (child === old) child = null; });
      old.kill();
      child = null;
    }
    const next = spawn(cfg.nodeBin, [join(cfg.hypitRepo, "bin/hypit.mjs"), "studio", "--run", req.body.run, "--port", port], {
      cwd: cfg.project,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child = next;
    currentRun = req.body.run;
    next.on("exit", () => { if (child === next) child = null; });
    await new Promise((r) => setTimeout(r, 2500));
    return { running: running(), url: `http://127.0.0.1:${port}`, run: currentRun };
  });
  app.delete("/api/studio", async () => {
    if (running()) {
      const old = child!;
      old.on("exit", () => { if (child === old) child = null; });
      old.kill();
    }
    child = null;
    return { running: false };
  });
}
