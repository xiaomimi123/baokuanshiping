import { describe, expect, it } from "vitest";
import { validateProfile } from "../src/validate-profile.js";

const good = {
  format: "hypit.runtime-local@1",
  dataRoot: ".hypit/runtimes/local",
  credentials: { os: { use: "@hypit/credential-store-os" } },
  endpoints: { "media.local": { use: "@hypit/provider-media-local" } },
};

describe("validateProfile（依赖本机 hypit 仓库，慢）", () => {
  it("合法 Profile 通过", async () => {
    expect(await validateProfile(good)).toEqual({ ok: true });
  }, 60_000);
  it("多余顶层键被拒", async () => {
    const bad = { ...good, extra: 1 };
    const res = await validateProfile(bad);
    expect(res.ok).toBe(false);
  }, 60_000);
  it("credentials 条目带 pool 被拒", async () => {
    const bad = structuredClone(good) as Record<string, any>;
    bad.credentials.os.pool = "x";
    expect((await validateProfile(bad)).ok).toBe(false);
  }, 60_000);
});
