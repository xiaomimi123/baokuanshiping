import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { cfg } from "./config.js";
import type { TemplateDef } from "./templates.js";

const execFileAsync = promisify(execFile);

export class ProjectError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ProjectMeta = {
  format: "workbench.project@1";
  template: string;
  title: string;
  createdAt: string;
  runSource: string;
  builds: string[];
  variables?: Record<string, string>;
};

const SLUG_RE = /^[a-z0-9._-]+$/;

/** projects 根 = cfg.project（default 项目）的父目录。 */
function projectsRoot(): string {
  return dirname(cfg.project);
}

/** 校验项目 slug：小写字母/数字/`.`/`_`/`-`，拒绝空串、`.`、`..`。不合法抛 400 语义错误。 */
export function assertSlug(name: string): void {
  if (!name || name === "." || name === ".." || !SLUG_RE.test(name)) {
    throw new ProjectError(400, "E_INVALID_NAME", `非法项目名：${JSON.stringify(name)}`);
  }
}

/** 校验并拼接 projects 根内的项目目录；解析后必须落在根内，否则抛 400。 */
export function projectDir(name: string): string {
  assertSlug(name);
  const root = projectsRoot();
  const dir = resolve(root, name);
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new ProjectError(400, "E_PATH_ESCAPE", `项目路径越界：${name}`);
  }
  return dir;
}

export async function readMeta(name: string): Promise<ProjectMeta> {
  const dir = projectDir(name);
  const raw = await readFile(join(dir, ".workbench.json"), "utf8");
  return JSON.parse(raw) as ProjectMeta;
}

/** 副作用：项目目录若不存在会被静默创建（recursive mkdir），调用方无需预先建目录。 */
export async function writeMeta(name: string, meta: ProjectMeta): Promise<void> {
  const dir = projectDir(name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".workbench.json"), JSON.stringify(meta, null, 2) + "\n");
}

const SLUG_MAX_LEN = 60;

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = base.slice(0, SLUG_MAX_LEN).replace(/-+$/g, "");
  return truncated || "project";
}

function randomSuffix(): string {
  return randomBytes(2).toString("hex"); // 4 位十六进制
}

/** 拷贝时排除的顶层/任意层目录名与文件名。 */
function shouldExclude(entryPath: string): boolean {
  const name = basename(entryPath);
  return name === "node_modules" || name === ".hypit" || name === "hypit.runtime.json";
}

/**
 * 模板自带 project component（packages/*）若无预编译 dist 但有 build 脚本，
 * 在创建时尝试用工作台自身的 tsc 编译一次。编译失败不阻塞创建，记 warning。
 */
async function compileBundledPackages(dir: string, warnings: string[]): Promise<void> {
  const packagesDir = join(dir, "packages");
  if (!existsSync(packagesDir)) return;
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const tscBin = join(import.meta.dirname, "../node_modules/.bin/tsc");
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    const pkgJsonPath = join(pkgDir, "package.json");
    const tsconfigPath = join(pkgDir, "tsconfig.json");
    if (existsSync(join(pkgDir, "dist"))) continue; // 已预编译
    if (!existsSync(pkgJsonPath) || !existsSync(tsconfigPath)) continue;
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8")) as { scripts?: Record<string, string> };
      if (!pkg.scripts?.build) continue;
      await execFileAsync(tscBin, ["-p", "tsconfig.json"], { cwd: pkgDir, timeout: 60_000 });
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
      warnings.push(
        `组件 packages/${entry.name} 创建时编译未完全成功（不影响项目创建；若出片报错找不到 dist，请检查该组件）：${message}`,
      );
    }
  }
}

/**
 * 创建视频项目：slug(title)+4 位随机目录名；复制模板 sourceDir（排除 node_modules/.hypit/hypit.runtime.json）；
 * 复制 default Profile 进项目并写 .hypit/runtime 指针；复制 default 的 provider 包（若已存在同名包则跳过）；
 * 编译模板自带且未预构建的 project component；建 assets/uploads；写 .workbench.json。
 */
export async function createProject(
  template: TemplateDef,
  title: string,
): Promise<{ name: string; warnings: string[] }> {
  if (typeof title !== "string") {
    throw new ProjectError(400, "E_BAD_TITLE", "title 必须是字符串");
  }
  const warnings: string[] = [];
  const root = projectsRoot();
  await mkdir(root, { recursive: true });

  let name = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${slugifyTitle(title)}-${randomSuffix()}`;
    if (!existsSync(join(root, candidate))) {
      name = candidate;
      break;
    }
  }
  if (!name) throw new ProjectError(500, "E_NAME_COLLISION", "无法生成唯一项目目录名，请重试");

  const dir = projectDir(name);
  await mkdir(dir, { recursive: true });

  const sourceDir = join(cfg.hypitRepo, "examples", template.sourceDir);
  await cp(sourceDir, dir, { recursive: true, filter: (src) => !shouldExclude(src) });

  // hypit CLI 按最近的 package.json 判定项目根（逐级向上找）；部分上游模板（如 semantic-composition）
  // 不自带顶层 package.json，若缺失会一路找到工作台自身仓库根导致 packages/* 解析到错误目录，故补一份。
  const packageJsonPath = join(dir, "package.json");
  if (!existsSync(packageJsonPath)) {
    await writeFile(packageJsonPath, JSON.stringify({ name, private: true, type: "module" }, null, 2) + "\n");
  }

  // Profile 指针方案（Task 1 定稿方案 B）：复制 default 的 Profile 进项目，写 .hypit/runtime 指针。
  const defaultProfile = join(cfg.project, "hypit.runtime.json");
  if (existsSync(defaultProfile)) {
    await copyFile(defaultProfile, join(dir, "hypit.runtime.json"));
    await mkdir(join(dir, ".hypit"), { recursive: true });
    await writeFile(join(dir, ".hypit/runtime"), "hypit.runtime.json\n");
  } else {
    warnings.push("未找到默认 Runtime Profile（projects/default/hypit.runtime.json），项目暂未绑定服务，出片前请先在总览页配置 Profile");
  }

  // 复用 default 已预编译的 provider 包（如 provider-volcengine/provider-openai-image/provider-gemini-image）：
  // 这是载荷性需求——新项目的 Profile bindings 引用 @workbench/provider-*，hypit CLI 按"项目本地 packages/"
  // 的约定解析这些包，不复制会导致对应 endpoint 激活失败。排除 node_modules（体积/符号链接卫生，dist 已够用，
  // 运行期不需要重新编译）；dist/ 保留，因为 providers:build 已产出，请求路径不需要再跑一次 tsc。
  const defaultPackagesDir = join(cfg.project, "packages");
  if (existsSync(defaultPackagesDir)) {
    const names = await readdir(defaultPackagesDir);
    for (const pkgName of names) {
      const dest = join(dir, "packages", pkgName);
      if (existsSync(dest)) continue; // 模板自带同名包优先，不覆盖
      await cp(join(defaultPackagesDir, pkgName), dest, { recursive: true, filter: (src) => !shouldExclude(src) });
    }
  }

  await compileBundledPackages(dir, warnings);

  await mkdir(join(dir, "assets/uploads"), { recursive: true });

  const meta: ProjectMeta = {
    format: "workbench.project@1",
    template: template.id,
    title,
    createdAt: new Date().toISOString(),
    runSource: template.runSource,
    builds: [],
  };
  await writeMeta(name, meta);

  return { name, warnings };
}

/** 扫描 projects/*，忽略 default 与无 .workbench.json（脏）目录。 */
export async function listProjects(): Promise<(ProjectMeta & { name: string })[]> {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const result: (ProjectMeta & { name: string })[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "default") continue;
    if (!SLUG_RE.test(entry.name)) continue;
    try {
      const meta = await readMeta(entry.name);
      result.push({ ...meta, name: entry.name });
    } catch {
      continue; // 无元数据或脏目录，忽略
    }
  }
  return result;
}
