import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { withSecretFile } from "../src/routes/auth.js";

describe("withSecretFile", () => {
  it("写入 0600、回调后删除", async () => {
    let seen = "";
    const captured = await withSecretFile("s3cret", async (p) => {
      seen = p;
      const st = await stat(p);
      expect(st.mode & 0o777).toBe(0o600);
      expect(await readFile(p, "utf8")).toBe("s3cret");
      return "done";
    });
    expect(captured).toBe("done");
    expect(existsSync(seen)).toBe(false);
  });
  it("回调抛错也删除", async () => {
    let seen = "";
    await expect(withSecretFile("x", async (p) => { seen = p; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(seen)).toBe(false);
  });
});
