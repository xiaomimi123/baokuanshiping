import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

// 与 projects.test.ts 相同套路：projects.ts 读取 cfg 单例，需先设好临时目录环境变量再动态 import。
let root = "";
let projects!: typeof import("../src/projects.js");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wb-variables-"));
  process.env.HYPIT_REPO = join(root, "hypit");
  process.env.HYPIT_PROJECT = join(root, "projects", "default");
  await mkdir(join(root, "hypit", "examples"), { recursive: true });
  await mkdir(process.env.HYPIT_PROJECT, { recursive: true });

  vi.resetModules();
  projects = await import("../src/projects.js");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setupProject(name: string, svmlContent: string): Promise<import("../src/projects.js").ProjectMeta> {
  const dir = projects.projectDir(name);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "assets/uploads"), { recursive: true });
  await writeFile(join(dir, "chat.svml"), svmlContent);
  const meta: import("../src/projects.js").ProjectMeta = {
    format: "workbench.project@1",
    template: "fake",
    title: "测试项目",
    createdAt: new Date().toISOString(),
    runSource: "chat.svrun",
    builds: [],
  };
  await projects.writeMeta(name, meta);
  return meta;
}

describe("applyVariables", () => {
  it("唯一锚点替换成功，且二次替换（新值作锚点）也成功", async () => {
    await setupProject("proj-a", "hello world, hello galaxy");
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "title", label: "标题", kind: "text", file: "chat.svml", anchor: "world" },
    ];

    await projects.applyVariables("proj-a", defs, { title: "there" });
    const dir = projects.projectDir("proj-a");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe("hello there, hello galaxy");
    const meta1 = await projects.readMeta("proj-a");
    expect(meta1.variables).toEqual({ title: "there" });

    // 第二次替换：当前锚点应是上次写入的新值 "there"，而不是原始 anchor "world"
    await projects.applyVariables("proj-a", defs, { title: "friend" });
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe("hello friend, hello galaxy");
    const meta2 = await projects.readMeta("proj-a");
    expect(meta2.variables).toEqual({ title: "friend" });
  });

  it("锚点在文件中出现 0 次 → E_ANCHOR 且文件未变", async () => {
    const content = "hello world";
    await setupProject("proj-b", content);
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "missing", label: "缺失变量", kind: "text", file: "chat.svml", anchor: "not-here" },
    ];

    await expect(projects.applyVariables("proj-b", defs, { missing: "x" })).rejects.toMatchObject({
      status: 400,
      code: "E_ANCHOR",
    });
    const dir = projects.projectDir("proj-b");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe(content);
  });

  it("锚点在文件中出现 >1 次 → E_ANCHOR 且报错含变量 label，文件未变", async () => {
    const content = "dup dup";
    await setupProject("proj-c", content);
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "dupKey", label: "重复变量标签", kind: "text", file: "chat.svml", anchor: "dup" },
    ];

    let error: unknown;
    try {
      await projects.applyVariables("proj-c", defs, { dupKey: "x" });
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ status: 400, code: "E_ANCHOR" });
    expect((error as Error).message).toContain("重复变量标签");
    const dir = projects.projectDir("proj-c");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe(content);
  });

  it("kind:asset 引用不存在的上传文件 → 400", async () => {
    await setupProject("proj-d", "asset: old.png");
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "cover", label: "封面素材", kind: "asset", file: "chat.svml", anchor: "old.png" },
    ];

    await expect(
      projects.applyVariables("proj-d", defs, { cover: "assets/uploads/nope.png" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("kind:asset 引用存在的上传文件 → 替换成功", async () => {
    await setupProject("proj-e", "asset: old.png");
    const dir = projects.projectDir("proj-e");
    await writeFile(join(dir, "assets/uploads", "new.png"), "fake-bytes");
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "cover", label: "封面素材", kind: "asset", file: "chat.svml", anchor: "old.png" },
    ];

    await projects.applyVariables("proj-e", defs, { cover: "assets/uploads/new.png" });
    // upstream（packages/workspace-fs-node resolveAsset）要求 source 必须以 "./" 或 "../" 开头，
    // 否则报 UNSUPPORTED_SOURCE_ASSET；applyVariables 写回前会补上这个前缀（见 C1 修复）。
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe("asset: ./assets/uploads/new.png");
  });

  it("kind:asset 裸文件名（不含 /）被规范化为 ./assets/uploads/<name> 后校验通过", async () => {
    await setupProject("proj-e2", "asset: old.png");
    const dir = projects.projectDir("proj-e2");
    await writeFile(join(dir, "assets/uploads", "bare.png"), "fake-bytes");
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "cover", label: "封面素材", kind: "asset", file: "chat.svml", anchor: "old.png" },
    ];

    // 裸名（无 "/"）视为落在 assets/uploads/ 下的素材，自动规范化后再校验，双保险防止
    // 前端/外部调用方误传裸文件名时被 E_ASSET_NOT_FOUND 拒绝。
    await projects.applyVariables("proj-e2", defs, { cover: "bare.png" });
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe("asset: ./assets/uploads/bare.png");
  });

  it("3 变量批次中第 2 个锚点不唯一 → 预校验阶段整体失败，所有文件与 meta 均不变", async () => {
    const content = "alpha one, beta two two, gamma three";
    await setupProject("proj-g", content);
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "k1", label: "第一个", kind: "text", file: "chat.svml", anchor: "alpha" },
      { key: "k2", label: "第二个", kind: "text", file: "chat.svml", anchor: "two" }, // 出现两次
      { key: "k3", label: "第三个", kind: "text", file: "chat.svml", anchor: "gamma" },
    ];

    await expect(
      projects.applyVariables("proj-g", defs, { k1: "A", k2: "B", k3: "C" }),
    ).rejects.toMatchObject({ status: 400, code: "E_ANCHOR" });

    const dir = projects.projectDir("proj-g");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe(content); // 第一个 key 也未被写盘
    const meta = await projects.readMeta("proj-g");
    expect(meta.variables).toBeUndefined(); // meta 完全未改动
  });

  it("预校验全部通过的多变量批次：全部成功写入，且互不干扰", async () => {
    const content = "alpha one, beta two, gamma three";
    await setupProject("proj-h", content);
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "k1", label: "第一个", kind: "text", file: "chat.svml", anchor: "alpha" },
      { key: "k2", label: "第二个", kind: "text", file: "chat.svml", anchor: "two" },
      { key: "k3", label: "第三个", kind: "text", file: "chat.svml", anchor: "gamma" },
    ];

    await projects.applyVariables("proj-h", defs, { k1: "A", k2: "B", k3: "C" });

    const dir = projects.projectDir("proj-h");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe("A one, beta B, C three");
    const meta = await projects.readMeta("proj-h");
    expect(meta.variables).toEqual({ k1: "A", k2: "B", k3: "C" });
  });

  it("trim 后为空的新值 → 400 E_BAD_VALUE（消息含 label），dry-run 阶段拒绝，磁盘零改动", async () => {
    const content = "hello world";
    await setupProject("proj-i2", content);
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "title", label: "标题", kind: "text", file: "chat.svml", anchor: "world" },
    ];

    let error: unknown;
    try {
      await projects.applyVariables("proj-i2", defs, { title: "   " });
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ status: 400, code: "E_BAD_VALUE" });
    expect((error as Error).message).toContain("标题");
    const dir = projects.projectDir("proj-i2");
    expect(await readFile(join(dir, "chat.svml"), "utf8")).toBe(content); // 磁盘零改动
    const meta = await projects.readMeta("proj-i2");
    expect(meta.variables).toBeUndefined(); // meta 也未改动（dry-run 阶段就拒）
  });

  it("原子写：替换后目标目录不残留 .tmp 文件", async () => {
    await setupProject("proj-f", "keep anchor-x here");
    const defs: import("../src/templates.js").VariableDef[] = [
      { key: "k", label: "K", kind: "text", file: "chat.svml", anchor: "anchor-x" },
    ];
    await projects.applyVariables("proj-f", defs, { k: "replaced" });
    const dir = projects.projectDir("proj-f");
    const entries = await readdir(dir);
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });
});
