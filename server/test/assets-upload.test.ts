import { describe, expect, it } from "vitest";
import { slugifyFilename } from "../src/routes/projects.js";

describe("slugifyFilename", () => {
  it("ASCII 文件名正常 slug 化", () => {
    expect(slugifyFilename("My Cover.PNG", new Set())).toBe("my-cover.png");
  });

  it("两个不同的纯中文文件名都保存且名字不同（I3：不再静默塌成同一个 asset.<ext> 互相覆盖）", () => {
    const existing = new Set<string>();
    const first = slugifyFilename("背景音乐.m4a", existing);
    existing.add(first);
    const second = slugifyFilename("片头音效.m4a", existing);
    existing.add(second);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^asset-[0-9a-f]{6}\.m4a$/);
    expect(second).toMatch(/^asset-[0-9a-f]{6}\.m4a$/);
  });

  it("slug 结果与已存在文件同名时递增 -2/-3 后缀，不静默覆盖", () => {
    const existing = new Set(["cover.png", "cover-2.png"]);
    expect(slugifyFilename("Cover.png", existing)).toBe("cover-3.png");
  });
});
