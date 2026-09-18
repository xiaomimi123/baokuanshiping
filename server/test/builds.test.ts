import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// resolveBuildCwd 读取 cfg（config.ts）单例，由 process.env 在模块首次加载时决定；每个用例前重置模块图，
// 与 projects.test.ts 的既有约定一致。
let root = "";
let resolveBuildCwd!: typeof import("../src/routes/builds.js").resolveBuildCwd;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wb-builds-"));
  process.env.HYPIT_REPO = join(root, "hypit");
  process.env.HYPIT_PROJECT = join(root, "projects", "default");
  await mkdir(join(root, "hypit"), { recursive: true });
  await mkdir(process.env.HYPIT_PROJECT, { recursive: true });

  vi.resetModules();
  ({ resolveBuildCwd } = await import("../src/routes/builds.js"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveBuildCwd", () => {
  it("不传 project → undefined（沿用默认项目 cwd，行为不变）", async () => {
    expect(await resolveBuildCwd(undefined)).toBeUndefined();
    expect(await resolveBuildCwd("")).toBeUndefined();
  });

  it("非法 slug（含 .. / 大写 / 斜杠）→ 抛 400 E_INVALID_NAME（不同模块实例，不用 instanceof，按 status/code 断言）", async () => {
    await expect(resolveBuildCwd("../escape")).rejects.toMatchObject({ status: 400, code: "E_INVALID_NAME" });
    await expect(resolveBuildCwd("UPPER")).rejects.toMatchObject({ status: 400, code: "E_INVALID_NAME" });
  });

  it("合法 slug 但项目目录不存在（无 .workbench.json）→ ENOENT", async () => {
    await expect(resolveBuildCwd("no-such-project")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("真实创作项目 → 返回其项目目录，与共享 default 项目隔离", async () => {
    const projectsRoot = join(root, "projects");
    const dir = join(projectsRoot, "task-x");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, ".workbench.json"),
      JSON.stringify({ format: "workbench.project@1", template: "t", title: "t", createdAt: "now", runSource: "x.svrun", builds: [] }),
    );

    const cwd = await resolveBuildCwd("task-x");
    expect(cwd).toBe(dir);
    expect(cwd).not.toBe(process.env.HYPIT_PROJECT);
  });
});
