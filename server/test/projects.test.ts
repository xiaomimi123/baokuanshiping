import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// projects.ts 读取 cfg（config.ts）单例，其内容由 process.env 在模块首次加载时决定；
// 因此这里在设置好临时目录环境变量之后再动态 import，避免污染真实 projects/。
let root = "";
let projects!: typeof import("../src/projects.js");
let TEMPLATES!: typeof import("../src/templates.js").TEMPLATES;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wb-projects-"));
  process.env.HYPIT_REPO = join(root, "hypit");
  process.env.HYPIT_PROJECT = join(root, "projects", "default");
  await mkdir(join(root, "hypit", "examples"), { recursive: true });
  await mkdir(process.env.HYPIT_PROJECT, { recursive: true });

  // 每个测试用独立模块图，避免 config.ts 顶层常量被上一个测试的 env 缓存。
  vi.resetModules();
  projects = await import("../src/projects.js");
  ({ TEMPLATES } = await import("../src/templates.js"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFakeTemplateSource(dirName: string): Promise<void> {
  const src = join(root, "hypit", "examples", dirName);
  await mkdir(src, { recursive: true });
  await writeFile(join(src, "chat.svml"), "hello world");
  await writeFile(join(src, "hypit.runtime.json"), JSON.stringify({ fake: true })); // 应被排除
  await mkdir(join(src, "node_modules", "leftover"), { recursive: true }); // 应被排除
  await writeFile(join(src, "node_modules", "leftover", "x.txt"), "x");
  await mkdir(join(src, ".hypit"), { recursive: true }); // 应被排除
  await writeFile(join(src, ".hypit", "runtime"), "should-not-copy");
}

describe("assertSlug", () => {
  it("拒绝路径穿越 ../x", () => {
    expect(() => projects.assertSlug("../x")).toThrow();
  });
  it("拒绝含斜杠 a/b", () => {
    expect(() => projects.assertSlug("a/b")).toThrow();
  });
  it("拒绝空串", () => {
    expect(() => projects.assertSlug("")).toThrow();
  });
  it("拒绝单独的 . 或 ..", () => {
    expect(() => projects.assertSlug(".")).toThrow();
    expect(() => projects.assertSlug("..")).toThrow();
  });
  it("拒绝含大写字母", () => {
    expect(() => projects.assertSlug("MyProject")).toThrow();
  });
  it("接受合法 slug", () => {
    expect(() => projects.assertSlug("chat-ab12")).not.toThrow();
  });
});

describe("projectDir", () => {
  it("解析后必须落在 projects 根内", () => {
    expect(() => projects.projectDir("../x")).toThrow();
  });
  it("合法 slug 拼出 projects 根下的路径", () => {
    const dir = projects.projectDir("chat-ab12");
    expect(dir.startsWith(join(root, "projects"))).toBe(true);
    expect(dir.endsWith(join("projects", "chat-ab12"))).toBe(true);
  });
});

describe("readMeta / writeMeta", () => {
  it("往返一致", async () => {
    const meta: import("../src/projects.js").ProjectMeta = {
      format: "workbench.project@1",
      template: "semantic-composition",
      title: "测试项目",
      createdAt: new Date().toISOString(),
      runSource: "chat.svrun",
      builds: ["b1"],
    };
    await projects.writeMeta("roundtrip-1234", meta);
    const read = await projects.readMeta("roundtrip-1234");
    expect(read).toEqual(meta);
  });
});

describe("createProject", () => {
  it("排除 node_modules/.hypit/hypit.runtime.json；建 assets/uploads；写 .workbench.json", async () => {
    await writeFakeTemplateSource("fake-template");
    const template = {
      id: "fake-template",
      title: "假模板",
      description: "测试用",
      sourceDir: "fake-template",
      runSource: "chat.svrun",
      requires: [],
      variables: [],
    };
    const result = await projects.createProject(template, "我的视频");
    expect(result.name).toMatch(/-[0-9a-f]{4}$/);

    const dir = projects.projectDir(result.name);
    expect(existsSync(join(dir, "chat.svml"))).toBe(true);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(existsSync(join(dir, ".hypit", "runtime"))).toBe(false); // 排除模板自带 .hypit，未复制其原内容
    expect(existsSync(join(dir, "hypit.runtime.json"))).toBe(false); // default 未提供 Profile 时不会生成
    expect(existsSync(join(dir, "assets", "uploads"))).toBe(true);

    const meta = await projects.readMeta(result.name);
    expect(meta.format).toBe("workbench.project@1");
    expect(meta.template).toBe("fake-template");
    expect(meta.title).toBe("我的视频");
    expect(meta.runSource).toBe("chat.svrun");
    expect(meta.builds).toEqual([]);
  });

  it("default 有 Profile 时复制进项目并写 .hypit/runtime 指针", async () => {
    await writeFakeTemplateSource("fake-template-2");
    await writeFile(join(process.env.HYPIT_PROJECT!, "hypit.runtime.json"), JSON.stringify({ format: "hypit.runtime-local@1" }));
    const template = {
      id: "fake-template-2",
      title: "假模板2",
      description: "测试用",
      sourceDir: "fake-template-2",
      runSource: "chat.svrun",
      requires: [],
      variables: [],
    };
    const result = await projects.createProject(template, "另一个视频");
    const dir = projects.projectDir(result.name);
    expect(existsSync(join(dir, "hypit.runtime.json"))).toBe(true);
    const pointer = await import("node:fs/promises").then((m) => m.readFile(join(dir, ".hypit", "runtime"), "utf8"));
    expect(pointer.trim()).toBe("hypit.runtime.json");
  });

  it("真实白名单模板（chat）注册表条目也能正常创建", async () => {
    const chat = TEMPLATES.find((t) => t.id === "semantic-composition")!;
    await writeFakeTemplateSource(chat.sourceDir);
    const result = await projects.createProject(chat, "冒烟测试");
    const dir = projects.projectDir(result.name);
    expect(existsSync(join(dir, ".workbench.json"))).toBe(true);
  });

  it("复用 default packages 时排除 node_modules、保留 dist、不触发编译", async () => {
    await writeFakeTemplateSource("fake-template-3");
    const defaultPkgDir = join(process.env.HYPIT_PROJECT!, "packages", "provider-fake");
    await mkdir(join(defaultPkgDir, "dist"), { recursive: true });
    const distMarkerContent = "// prebuilt, must survive untouched\n";
    await writeFile(join(defaultPkgDir, "dist", "activation.js"), distMarkerContent);
    await writeFile(join(defaultPkgDir, "package.json"), JSON.stringify({ name: "@workbench/provider-fake", scripts: { build: "tsc -p tsconfig.json" } }));
    await writeFile(join(defaultPkgDir, "tsconfig.json"), JSON.stringify({}));
    await mkdir(join(defaultPkgDir, "node_modules", "some-dep"), { recursive: true }); // 应被排除
    await writeFile(join(defaultPkgDir, "node_modules", "some-dep", "index.js"), "x");

    const template = {
      id: "fake-template-3",
      title: "假模板3",
      description: "测试用",
      sourceDir: "fake-template-3",
      runSource: "chat.svrun",
      requires: [],
      variables: [],
    };
    const result = await projects.createProject(template, "复用 provider 包");
    const dir = projects.projectDir(result.name);
    const copiedPkgDir = join(dir, "packages", "provider-fake");

    expect(existsSync(join(copiedPkgDir, "node_modules"))).toBe(false); // 排除
    expect(existsSync(join(copiedPkgDir, "dist", "activation.js"))).toBe(true); // dist 保留
    const copiedContent = await import("node:fs/promises").then((m) => m.readFile(join(copiedPkgDir, "dist", "activation.js"), "utf8"));
    expect(copiedContent).toBe(distMarkerContent); // 内容与源一致，证明未被 tsc 重新编译覆盖
    expect(result.warnings.some((w) => w.includes("provider-fake"))).toBe(false); // 未触发编译，自然无编译 warning
  });
});

describe("createProject 的 title 校验", () => {
  const template = {
    id: "fake-template-title",
    title: "假模板",
    description: "测试用",
    sourceDir: "fake-template-title",
    runSource: "chat.svrun",
    requires: [],
    variables: [],
  };

  it("超长 title 的 slug 部分截断到 60 字符", async () => {
    await writeFakeTemplateSource("fake-template-title");
    const longTitle = "a".repeat(200);
    const result = await projects.createProject(template, longTitle);
    const slugPart = result.name.replace(/-[0-9a-f]{4}$/, "");
    expect(slugPart.length).toBeLessThanOrEqual(60);
  });

  it("非字符串 title 抛 400 E_BAD_TITLE", async () => {
    await writeFakeTemplateSource("fake-template-title");
    await expect(projects.createProject(template, 123 as unknown as string)).rejects.toMatchObject({
      status: 400,
      code: "E_BAD_TITLE",
    });
  });
});

describe("listProjects", () => {
  it("忽略 default 与无元数据的脏目录", async () => {
    const projectsRoot = join(root, "projects");
    await mkdir(join(projectsRoot, "default"), { recursive: true }); // 与 cfg.project 同名，应被忽略
    await mkdir(join(projectsRoot, "dirty-abcd"), { recursive: true }); // 无 .workbench.json，脏目录
    await projects.writeMeta("valid-1234", {
      format: "workbench.project@1",
      template: "semantic-composition",
      title: "有效项目",
      createdAt: new Date().toISOString(),
      runSource: "chat.svrun",
      builds: [],
    });
    const list = await projects.listProjects();
    expect(list.map((p) => p.name)).toEqual(["valid-1234"]);
  });
});
