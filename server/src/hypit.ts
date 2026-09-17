import { execFile } from "node:child_process";
import { join } from "node:path";
import { cfg } from "./config.js";

export class HypitCliError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function parseCliJson(stdout: string, exitCode: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (exitCode !== 0) throw new HypitCliError("E_CLI", `hypit 退出码 ${exitCode}`, stdout.slice(0, 2000));
    throw new HypitCliError("E_PARSE", "hypit 输出不是 JSON", stdout.slice(0, 2000));
  }
  const view = parsed as Record<string, unknown>;
  if (view.format === "hypit.cli-error@1") {
    throw new HypitCliError(String(view.code ?? "E_CLI"), String(view.message ?? "hypit 命令失败"), view);
  }
  return view;
}

export function runHypit(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  const bin = join(cfg.hypitRepo, "bin/hypit.mjs");
  return new Promise((resolvePromise, reject) => {
    execFile(
      cfg.nodeBin,
      [bin, ...args, "--json"],
      { cwd: opts.cwd ?? cfg.project, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        const exitCode = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? Number((error as { code: number }).code)
          : error ? 1 : 0;
        try {
          resolvePromise(parseCliJson(stdout, exitCode));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}
