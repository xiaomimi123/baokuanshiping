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

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode != null || proc.signalCode != null) return true;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

async function stopAndWait(proc: ChildProcess): Promise<void> {
  proc.kill();
  const exited = await waitForExit(proc, 5000);
  if (!exited) {
    proc.kill("SIGKILL");
    await waitForExit(proc, 5000);
  }
}

export async function studioRoutes(app: FastifyInstance) {
  app.get("/api/studio", async () => ({
    running: running(),
    ...(running() ? { url: `http://127.0.0.1:${port}`, run: currentRun } : {}),
  }));
  app.post<{ Body: { run: string } }>("/api/studio", async (req, reply) => {
    const run = req.body?.run;
    if (typeof run !== "string" || run.trim() === "") {
      return reply.status(400).send({ error: { code: "E_BAD_RUN", message: "run 必须是非空字符串" } });
    }
    if (running() && currentRun === run) return { running: true, url: `http://127.0.0.1:${port}`, run: currentRun };
    if (child != null) {
      const old = child;
      child = null;
      await stopAndWait(old);
    }
    const next = spawn(cfg.nodeBin, [join(cfg.hypitRepo, "bin/hypit.mjs"), "studio", "--run", run, "--port", port], {
      cwd: cfg.project,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child = next;
    currentRun = run;
    next.on("exit", () => { if (child === next) child = null; });
    next.on("error", (err) => {
      app.log.error(err, "studio 子进程启动失败");
      if (child === next) child = null;
    });
    await new Promise((r) => setTimeout(r, 2500));
    if (!running()) {
      return reply.status(502).send({ error: { code: "E_STUDIO", message: "Studio 启动失败，请检查 run 路径与服务器日志" } });
    }
    return { running: true, url: `http://127.0.0.1:${port}`, run: currentRun };
  });
  app.delete("/api/studio", async () => {
    if (child != null) {
      const old = child;
      child = null;
      await stopAndWait(old);
    }
    return { running: false };
  });
}
