import { describe, expect, it } from "vitest";
import { EndpointRegistry, MemoryResourceStore } from "@hypit/driver-node";
import type { BlobRef, EndpointInvocationContext, EndpointRequest } from "@hypit/hypit/endpoint-kit";
import { canonicalize } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";
import { capabilityNanoBanana2, capabilityNanoBananaPro, createGeminiImageProvider } from "../src/provider.js";
import activationModule from "../src/activation.js";

function need(
  capability: typeof capabilityNanoBanana2 | typeof capabilityNanoBananaPro,
  ports: Record<string, unknown>,
  id = "need:test",
): EndpointRequest & { readonly id: string; readonly result: string } {
  return {
    id,
    capability,
    returns: generationTypes.imageSet,
    constraints: canonicalize({ ports }),
    result: `record:${id}`,
  };
}

const PNG_BYTES_A = new Uint8Array([137, 80, 78, 71, 1]);
const PNG_BYTES_B = new Uint8Array([137, 80, 78, 71, 2]);
const B64_A = Buffer.from(PNG_BYTES_A).toString("base64");
const B64_B = Buffer.from(PNG_BYTES_B).toString("base64");

const DEFAULT_MODEL_MAP = {
  "nano-banana-2": "gemini-2.5-flash-image",
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

describe("Gemini（Nano Banana）图像 Provider", () => {
  it("请求体含 prompt/图片/aspectRatio 透传，且请求头带 x-goog-api-key", async () => {
    const resources = new MemoryResourceStore();
    const calls: string[] = [];
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" }, modelMap: DEFAULT_MODEL_MAP,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        expect(url.pathname).toBe("/v1beta/models/gemini-2.5-flash-image:generateContent");
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
        const body = JSON.parse(String(init?.body));
        expect(body.contents[0].parts[0]).toEqual({ text: "一只猫在窗台上" });
        expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
        expect(body.generationConfig.imageConfig.aspectRatio).toBe("16:9");
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: B64_A } }] } } ] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBanana2, { prompt: ["一只猫在窗台上"], aspectRatio: ["16:9"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    expect(calls).toEqual(["/v1beta/models/gemini-2.5-flash-image:generateContent"]);
    expect(result.value.kind).toBe("inline");
  });

  it("响应 parts 中的多个 inlineData 全部落盘并封装为生成结果", async () => {
    const resources = new MemoryResourceStore();
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" }, modelMap: DEFAULT_MODEL_MAP,
      fetch: async () => Response.json({
        candidates: [{ content: { parts: [
          { inlineData: { mimeType: "image/png", data: B64_A } },
          { inlineData: { mimeType: "image/png", data: B64_B } },
        ] } }],
      }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBanana2, { prompt: ["两张图"], aspectRatio: ["1:1"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:multi", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    const images = (result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images).toHaveLength(2);
    expect(await resources.get(images[0]!.resource)).toEqual(PNG_BYTES_A);
    expect(await resources.get(images[1]!.resource)).toEqual(PNG_BYTES_B);
  });

  it("modelMap 中模型 ID 为空字符串时抛出提示配置的中文错误", async () => {
    const resources = new MemoryResourceStore();
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" },
      modelMap: { "nano-banana-2": "", "nano-banana-pro": "gemini-3-pro-image-preview" },
      fetch: async () => { throw new Error("不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBanana2, { prompt: ["一只猫"], aspectRatio: ["1:1"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:empty-model", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    await expect(resolution.registration.handler(context)).rejects.toThrow(
      "请在配置中填写 Gemini 模型 ID（modelMap.nano-banana-2）",
    );
  });

  it("supports() 拒绝 Gemini 支持列表外的宽高比 32:9，reason 为非空中文说明", async () => {
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" }, modelMap: DEFAULT_MODEL_MAP,
      fetch: async () => { throw new Error("不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBananaPro, { prompt: ["一只猫"], aspectRatio: ["32:9"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("unsupported");
    if (resolution.status !== "unsupported") throw new Error("unreachable");
    expect(resolution.rejections[0]?.reason.length).toBeGreaterThan(0);
    expect(resolution.rejections[0]?.reason).toMatch(/[一-鿿]/u);
  });

  it("nano-banana-2 + resolution 1K 时请求体不含 imageConfig.imageSize（imageSize 仅 Pro 模型可用）", async () => {
    const resources = new MemoryResourceStore();
    let seenBody: Record<string, unknown> | undefined;
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" }, modelMap: DEFAULT_MODEL_MAP,
      fetch: async (_input, init) => {
        seenBody = JSON.parse(String(init?.body));
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: B64_A } }] } }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBanana2, { prompt: ["一只猫"], aspectRatio: ["1:1"], resolution: ["1K"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:no-image-size", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    await resolution.registration.handler(context);
    const imageConfig = seenBody?.generationConfig as { imageConfig?: Record<string, unknown> } | undefined;
    expect(imageConfig?.imageConfig?.aspectRatio).toBe("1:1");
    expect(imageConfig?.imageConfig?.imageSize).toBeUndefined();
  });

  it("脱敏：HTTP 错误消息不含 API Key", async () => {
    const resources = new MemoryResourceStore();
    const provider = createGeminiImageProvider({
      instance: "gemini.images", pool: "gemini.images", baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" }, modelMap: DEFAULT_MODEL_MAP,
      fetch: async () => Response.json({ error: { message: "API key not valid" } }, { status: 400 }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityNanoBanana2, { prompt: ["一只猫"], aspectRatio: ["1:1"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:fail", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    try {
      await resolution.registration.handler(context);
      throw new Error("expected handler to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("test-key");
    }
  });

  it("activation：modelMap.nano-banana-2 为空字符串时不抛错，回落到默认模型 ID", async () => {
    const resources = new MemoryResourceStore();
    let seenUrl: string | undefined;
    const activate = activationModule.hostFacets[0]?.implementation as {
      activate: (context: {
        hostStateRoot: string; dataRoot: string; instance: string; pool?: string; config: unknown;
      }) => { endpoint: ReturnType<typeof createGeminiImageProvider> } | Promise<{ endpoint: ReturnType<typeof createGeminiImageProvider> }>;
    };
    // activation.ts does not pass a `fetch` override, so createGeminiImageProvider() captures
    // globalThis.fetch at activation time — the spy must be installed BEFORE calling activate().
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: B64_A } }] } }] });
    }) as typeof fetch;
    try {
      const activation = await activate.activate({
        hostStateRoot: "", dataRoot: "", instance: "gemini.images", pool: "gemini.images",
        config: canonicalize({
          baseUrl: "https://generativelanguage.googleapis.com",
          apiKey: { store: "file", key: "gemini.images" },
          modelMap: { "nano-banana-2": "", "nano-banana-pro": "gemini-3-pro-image-preview" },
          defaultConcurrency: 2,
          requestTimeoutMs: 180000,
        }),
      });
      const registry = new EndpointRegistry();
      await activation.endpoint.install(registry);
      const request = need(capabilityNanoBanana2, { prompt: ["一只猫"], aspectRatio: ["1:1"] });
      const resolved = registry.resolve(request);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved" || resolved.registration.kind !== "immediate") throw new Error("unreachable");
      const context: EndpointInvocationContext = {
        command: { kind: "fulfill-need", id: "command:activation-fallback", need: request },
        need: request,
        resources,
        credentials: { apiKey: { secret: "test-key" } },
      };
      await resolved.registration.handler(context);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
  });
});
