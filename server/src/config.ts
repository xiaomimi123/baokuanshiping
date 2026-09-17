import { resolve } from "node:path";

const repo = resolve(process.env.HYPIT_REPO ?? resolve(import.meta.dirname, "../../../hypit"));

export const cfg = {
  hypitRepo: repo,
  project: resolve(process.env.HYPIT_PROJECT ?? resolve(repo, "../projects/default")),
  port: Number(process.env.PORT ?? 8090),
  host: process.env.HOST ?? "127.0.0.1",
  nodeBin: process.execPath,
};
