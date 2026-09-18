import { describe, expect, it } from "vitest";
import { parseCliJson, HypitCliError } from "../src/hypit.js";

describe("parseCliJson", () => {
  it("解析正常 machine view", () => {
    const out = JSON.stringify({ format: "hypit.cli-doctor@1", ok: true, diagnostics: [] });
    expect(parseCliJson(out, 0)).toMatchObject({ format: "hypit.cli-doctor@1", ok: true });
  });
  it("cli-error 转 HypitCliError", () => {
    const out = JSON.stringify({ format: "hypit.cli-error@1", code: "E_X", message: "boom" });
    expect(() => parseCliJson(out, 1)).toThrowError(HypitCliError);
    try { parseCliJson(out, 1); } catch (e) {
      expect((e as HypitCliError).code).toBe("E_X");
      expect((e as HypitCliError).message).toBe("boom");
    }
  });
  it("cli-error 真实 CLI 形态（code/message 嵌在 error 字段内）转 HypitCliError", () => {
    const out = JSON.stringify({ format: "hypit.cli-error@1", ok: false, error: { code: "E_Y", message: "boom-nested" } });
    try { parseCliJson(out, 1); throw new Error("应抛出 HypitCliError"); } catch (e) {
      expect(e).toBeInstanceOf(HypitCliError);
      expect((e as HypitCliError).code).toBe("E_Y");
      expect((e as HypitCliError).message).toBe("boom-nested");
    }
  });
  it("非 JSON 输出 + 非零退出码 → HypitCliError(code=E_CLI)", () => {
    expect(() => parseCliJson("garbage", 2)).toThrowError(HypitCliError);
  });
  it("doctor ok=false 且 exit 1 是合法输出，不抛错", () => {
    const out = JSON.stringify({ format: "hypit.cli-doctor@1", ok: false, diagnostics: [{ severity: "error", code: "X", message: "m" }] });
    expect(parseCliJson(out, 1)).toMatchObject({ ok: false });
  });
});
