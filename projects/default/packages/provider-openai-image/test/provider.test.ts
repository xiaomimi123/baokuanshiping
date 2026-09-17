import { describe, expect, it } from "vitest";
import { EndpointRegistry, MemoryResourceStore } from "@hypit/driver-node";
import type { BlobRef, EndpointInvocationContext, EndpointRequest } from "@hypit/hypit/endpoint-kit";
import { canonicalize } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";
import { capability, createOpenAiImageProvider } from "../src/provider.js";

function need(ports: Record<string, unknown>, id = "need:test"): EndpointRequest & { readonly id: string; readonly result: string } {
  return {
    id,
    capability,
    returns: generationTypes.imageSet,
    constraints: canonicalize({ ports }),
    result: `record:${id}`,
  };
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
const B64_PNG = Buffer.from(PNG_BYTES).toString("base64");

describe("OpenAI 兼容图像 Provider", () => {
  it("无参考图时走 /v1/images/generations，映射 aspectRatio 为 size 并落盘生成结果", async () => {
    const resources = new MemoryResourceStore();
    const calls: string[] = [];
    const progress: string[] = [];
    const provider = createOpenAiImageProvider({
      instance: "openai.images", pool: "openai.images", baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" }, wireModel: "gpt-image-1",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        expect(url.pathname).toBe("/v1/images/generations");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
        expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
        expect(JSON.parse(String(init?.body))).toEqual({
          model: "gpt-image-1", prompt: "一只猫在窗台上", size: "1536x1024", n: 1,
        });
        return Response.json({ data: [{ b64_json: B64_PNG }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need({ prompt: ["一只猫在窗台上"], aspectRatio: ["3:2"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
      reportProgress: async (value) => { progress.push(value.phase); },
    };
    const result = await resolution.registration.handler(context);
    expect(calls).toEqual(["/v1/images/generations"]);
    expect(progress).toEqual(["提交 OpenAI 图像请求"]);
    expect(result.value.kind).toBe("inline");
    const images = (result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images[0]?.mediaType).toBe("image/png");
    expect(await resources.get(images[0]!.resource)).toEqual(PNG_BYTES);
  });

  it("响应字节是 JPEG 时，mediaType 按 magic bytes 嗅探为 image/jpeg（不信任固定 image/png）", async () => {
    const resources = new MemoryResourceStore();
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const b64Jpeg = Buffer.from(jpegBytes).toString("base64");
    const provider = createOpenAiImageProvider({
      instance: "openai.images", pool: "openai.images", baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" }, wireModel: "gpt-image-1",
      fetch: async () => Response.json({ data: [{ b64_json: b64Jpeg }] }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need({ prompt: ["一只猫"], aspectRatio: ["1:1"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:jpeg", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    const images = (result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images[0]?.mediaType).toBe("image/jpeg");
    expect(await resources.get(images[0]!.resource)).toEqual(jpegBytes);
  });

  it("有参考图时走 /v1/images/edits 的 multipart 请求，携带图片字节", async () => {
    const resources = new MemoryResourceStore();
    const source = await resources.put(new Uint8Array([1, 2, 3]), "image/png");
    const calls: string[] = [];
    const provider = createOpenAiImageProvider({
      instance: "openai.images", pool: "openai.images", baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" }, wireModel: "gpt-image-1",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        expect(url.pathname).toBe("/v1/images/edits");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("gpt-image-1");
        expect(form.get("prompt")).toBe("给这张图加个帽子");
        expect(form.get("size")).toBe("1024x1024");
        const uploaded = form.get("image[]") as Blob;
        expect(uploaded).toBeInstanceOf(Blob);
        expect(uploaded.type).toBe("image/png");
        expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        return Response.json({ data: [{ b64_json: B64_PNG }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need({
      prompt: ["给这张图加个帽子"], aspectRatio: ["1:1"],
      images: [{ role: "image", artifact: source }],
    });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:edit", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    expect(calls).toEqual(["/v1/images/edits"]);
    expect(result.value.kind).toBe("inline");
  });

  it("supports() 拒绝映射表外的宽高比 4:5，reason 为非空中文说明", async () => {
    const provider = createOpenAiImageProvider({
      instance: "openai.images", pool: "openai.images", baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" }, wireModel: "gpt-image-1",
      fetch: async () => { throw new Error("不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need({ prompt: ["一只猫"], aspectRatio: ["4:5"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("unsupported");
    if (resolution.status !== "unsupported") throw new Error("unreachable");
    expect(resolution.rejections[0]?.reason.length).toBeGreaterThan(0);
    expect(resolution.rejections[0]?.reason).toMatch(/[一-鿿]/u);
  });

  it("HTTP 401 时错误消息包含状态码且不泄露 API Key", async () => {
    const resources = new MemoryResourceStore();
    const provider = createOpenAiImageProvider({
      instance: "openai.images", pool: "openai.images", baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" }, wireModel: "gpt-image-1",
      fetch: async () => Response.json(
        { error: { message: "Incorrect API key provided" } },
        { status: 401 },
      ),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need({ prompt: ["一只猫"], aspectRatio: ["1:1"] });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:fail", need: request },
      need: request,
      resources,
      credentials: { apiKey: { secret: "test-key" } },
    };
    await expect(resolution.registration.handler(context)).rejects.toThrow(/401/u);
    try {
      await resolution.registration.handler(context);
      throw new Error("expected handler to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("test-key");
    }
  });
});
