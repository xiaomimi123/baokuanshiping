// 用法: tsx validate-profile-entry.ts <profile.json 的绝对路径>
// cwd 必须是 hypit 仓库根，以便解析 workspace 依赖。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [, , profilePath] = process.argv;
const configModule = resolve(process.cwd(), "packages/runtime-local/src/config.ts");
const { parseLocalRuntimeProfile } = await import(pathToFileURL(configModule).href);
try {
  parseLocalRuntimeProfile(JSON.parse(readFileSync(profilePath, "utf8")));
  process.exit(0);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
