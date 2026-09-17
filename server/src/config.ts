import { resolve } from "node:path";

const repo = resolve(process.env.HYPIT_REPO ?? resolve(import.meta.dirname, "../../../hypit"));

export const cfg = {
  hypitRepo: repo,
  project: resolve(process.env.HYPIT_PROJECT ?? repo),
  port: Number(process.env.PORT ?? 8090),
  nodeBin: process.execPath,
};
