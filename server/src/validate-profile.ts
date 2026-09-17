import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cfg } from "./config.js";

export async function validateProfile(json: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const dir = await mkdtemp(join(tmpdir(), "wb-profile-"));
  try {
    const file = join(dir, "hypit.runtime.json");
    await writeFile(file, JSON.stringify(json, null, 2));
    const entry = resolve(import.meta.dirname, "scripts/validate-profile-entry.ts");
    const tsxBin = join(cfg.hypitRepo, "node_modules/.bin/tsx");
    return await new Promise((res) => {
      execFile(tsxBin, [entry, file], { cwd: cfg.hypitRepo, timeout: 60_000 }, (error, _stdout, stderr) => {
        if (error) res({ ok: false, message: stderr.trim() || error.message });
        else res({ ok: true });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
