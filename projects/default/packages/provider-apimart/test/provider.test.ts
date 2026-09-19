import { describe, expect, it } from "vitest";
import { EndpointRegistry, MemoryResourceStore } from "@hypit/driver-node";
import type { BlobRef, EndpointPollContext, EndpointRequest, EndpointStartContext } from "@hypit/hypit/endpoint-kit";
import { canonicalize } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";
import {
  capabilityGptImage2, capabilitySeedance2, createApimartProvider,
} from "../src/provider.js";

function need(
  capability: typeof capabilitySeedance2 | typeof capabilityGptImage2,
  returns: typeof generationTypes.videoSet | typeof generationTypes.imageSet,
  ports: Record<string, unknown>,
  id = "need:test",
): EndpointRequest & { readonly id: string; readonly result: string } {
  return {
    id,
    capability,
    returns,
    constraints: canonicalize({ ports }),
    result: `record:${id}`,
  };
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 1]);
const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

const MODEL_MAP = {
  "seedance-2": "seedance-2.0",
  "seedance-2-fast": "seedance-2.0-fast",
  "seedance-2-mini": "seedance-2.0-mini",
  "seedance-2.5": "seedance-2.5",
  "gpt-image-2": "gpt-image-2",
};

describe("APIMart（Seedance 视频 / GPT Image 生图）Provider", () => {
  it("视频 start：请求体含 model/size/duration/generate_audio，Authorization 头正确", async () => {
    const resources = new MemoryResourceStore();
    let seenUrl: string | undefined;
    let seenHeaders: Record<string, string> | undefined;
    let seenBody: Record<string, unknown> | undefined;
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        seenUrl = String(input);
        seenHeaders = init?.headers as Record<string, string>;
        seenBody = JSON.parse(String(init?.body));
        return Response.json({ code: 200, data: [{ status: "submitted", task_id: "task-video-001" }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, {
      prompt: ["一只猫在窗台上打哈欠"],
      resolution: ["720p"],
      aspectRatio: ["16:9"],
      duration: [5],
      generateAudio: [false],
    });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const context: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
    };
    const outcome = await resolution.registration.endpoint.start(context);
    expect(seenUrl).toBe("https://api.apimart.ai/v1/videos/generations");
    expect(seenHeaders?.authorization).toBe("Bearer test-key");
    expect(seenBody?.model).toBe("seedance-2.0");
    expect(seenBody?.resolution).toBe("720p");
    expect(seenBody?.size).toBe("16:9");
    expect(seenBody?.duration).toBe(5);
    expect(seenBody?.generate_audio).toBe(false);
    expect(outcome.status).toBe("pending");
    expect(outcome.receipt).toEqual({ id: "task-video-001" });
  });

  it("视频 poll：processing 状态返回 pending，completed 状态返回 ready", async () => {
    const resources = new MemoryResourceStore();
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const handle = canonicalize({
      contract: "workbench.apimart-task@1", taskId: "task-video-002",
      capability: "seedance-2", startedAt: Date.now(),
    });
    const pollContextFor = (): EndpointPollContext => ({
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test", handle,
    });

    let statusToReturn = "processing";
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ code: 200, data: { id: "task-video-002", status: statusToReturn } }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");

    const pendingOutcome = await resolution.registration.endpoint.poll(pollContextFor());
    expect(pendingOutcome.status).toBe("pending");

    statusToReturn = "completed";
    const readyOutcome = await resolution.registration.endpoint.poll(pollContextFor());
    expect(readyOutcome.status).toBe("ready");
  });

  it("视频 collect：从 result.videos[0].url[0] 下载视频字节并落库为 videoSet（下载请求不带 Authorization）", async () => {
    const resources = new MemoryResourceStore();
    let sawAuthorizationOnDownload = false;
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("signed-video")) {
          if ((init?.headers as Record<string, string> | undefined)?.authorization !== undefined) sawAuthorizationOnDownload = true;
          return new Response(MP4_BYTES, { status: 200 });
        }
        return Response.json({
          code: 200,
          data: { id: "task-video-003", status: "completed", result: { videos: [{ url: ["https://cdn.apimart.ai/signed-video/xxx.mp4"] }] } },
        });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const handle = canonicalize({
      contract: "workbench.apimart-task@1", taskId: "task-video-003",
      capability: "seedance-2", startedAt: Date.now(),
    });
    const context: EndpointPollContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test", handle,
    };
    const outcome = await resolution.registration.endpoint.collect!(context);
    expect(outcome.status).toBe("completed");
    expect(sawAuthorizationOnDownload).toBe(false);
    if (outcome.status !== "completed") throw new Error("unreachable");
    const videos = (outcome.result.value.value as unknown as { videos: BlobRef[] }).videos;
    expect(videos).toHaveLength(1);
    expect(await resources.get(videos[0]!.resource)).toEqual(MP4_BYTES);
  });

  it("图片全流程：start 请求体 size/resolution 小写，poll ready 后 collect 多图落库为 imageSet", async () => {
    const resources = new MemoryResourceStore();
    let seenBody: Record<string, unknown> | undefined;
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/v1/images/generations")) {
          seenBody = JSON.parse(String(init?.body));
          return Response.json({ code: 200, data: [{ status: "submitted", task_id: "task-image-001" }] });
        }
        if (url.includes("/v1/tasks/")) {
          return Response.json({
            code: 200,
            data: {
              id: "task-image-001", status: "completed",
              result: { images: [{ url: ["https://cdn.apimart.ai/signed-image/a.png"] }, { url: ["https://cdn.apimart.ai/signed-image/b.png"] }] },
            },
          });
        }
        return new Response(PNG_BYTES, { status: 200 });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityGptImage2, generationTypes.imageSet, {
      prompt: ["一只猫在窗台上"], aspectRatio: ["1:1"], resolution: ["1K"],
    });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const startContext: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
    };
    const startOutcome = await resolution.registration.endpoint.start(startContext);
    expect(startOutcome.status).toBe("pending");
    expect(seenBody?.model).toBe("gpt-image-2");
    expect(seenBody?.n).toBe(1);
    expect(seenBody?.size).toBe("1:1");
    expect(seenBody?.resolution).toBe("1k");

    const handle = canonicalize({
      contract: "workbench.apimart-task@1", taskId: "task-image-001",
      capability: "gpt-image-2", startedAt: Date.now(),
    });
    const pollContext: EndpointPollContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test", handle,
    };
    const pollOutcome = await resolution.registration.endpoint.poll(pollContext);
    expect(pollOutcome.status).toBe("ready");

    const collectOutcome = await resolution.registration.endpoint.collect!(pollContext);
    expect(collectOutcome.status).toBe("completed");
    if (collectOutcome.status !== "completed") throw new Error("unreachable");
    const images = (collectOutcome.result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images).toHaveLength(2);
    expect(await resources.get(images[0]!.resource)).toEqual(PNG_BYTES);
    expect(await resources.get(images[1]!.resource)).toEqual(PNG_BYTES);
  });

  it("模型 ID 缺失：start 返回 failed（APIMART_MODEL_ID_MISSING），文案含中文与配置路径", async () => {
    const resources = new MemoryResourceStore();
    const emptyModelMap = { ...MODEL_MAP, "seedance-2": "", "gpt-image-2": "" };
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: emptyModelMap,
      fetch: async () => { throw new Error("不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);

    const videoRequest = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const videoResolution = registry.resolve(videoRequest);
    if (videoResolution.status !== "resolved" || videoResolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const startContext: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:test", need: videoRequest },
      need: videoRequest, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
    };
    const outcome = await videoResolution.registration.endpoint.start(startContext);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.failure.code).toBe("APIMART_MODEL_ID_MISSING");
    expect(outcome.failure.message).toContain("modelMap.seedance-2");
    expect(outcome.failure.message).toMatch(/[一-鿿]/u);

    const imageRequest = need(capabilityGptImage2, generationTypes.imageSet, { prompt: ["一只猫"] });
    const imageResolution = registry.resolve(imageRequest);
    if (imageResolution.status !== "resolved" || imageResolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const imageStartContext: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:test-image", need: imageRequest },
      need: imageRequest, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
    };
    const imageOutcome = await imageResolution.registration.endpoint.start(imageStartContext);
    expect(imageOutcome.status).toBe("failed");
    if (imageOutcome.status !== "failed") throw new Error("unreachable");
    expect(imageOutcome.failure.code).toBe("APIMART_MODEL_ID_MISSING");
    expect(imageOutcome.failure.message).toContain("modelMap.gpt-image-2");
  });

  it("脱敏：HTTP 错误消息不含 API Key", async () => {
    const resources = new MemoryResourceStore();
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ message: "invalid api key test-key" }, { status: 401 }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilityGptImage2, generationTypes.imageSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const context: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:fail", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
    };
    const outcome = await resolution.registration.endpoint.start(context);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    // 错误消息里唯一可能出现真实 key 值的路径是回显请求方自己发送的 secret；这里断言脱敏后的消息
    // 不包含调用方 credentials 里配置的真实密钥字符串。
    expect(outcome.failure.message).not.toContain("Bearer test-key");
  });

  it("脱敏：视频下载失败时签名 URL 被 [redacted-url] 替换", async () => {
    const resources = new MemoryResourceStore();
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("signed-video")) throw new Error(`request to ${url} failed, reason: connect ETIMEDOUT`);
        return Response.json({
          code: 200,
          data: { id: "task-video-004", status: "completed", result: { videos: [{ url: ["https://cdn.apimart.ai/signed-video/xxx.mp4?token=test-key-secret"] }] } },
        });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const handle = canonicalize({
      contract: "workbench.apimart-task@1", taskId: "task-video-004",
      capability: "seedance-2", startedAt: Date.now(),
    });
    const context: EndpointPollContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test", handle,
    };
    const outcome = await resolution.registration.endpoint.collect!(context);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.failure.message).not.toContain("token=test-key-secret");
    expect(outcome.failure.message).toContain("[redacted-url]");
  });

  it("端口支持面：视频不支持 referenceImage 等，图片不支持 images 参考", async () => {
    const resources = new MemoryResourceStore();
    const provider = createApimartProvider({
      instance: "apimart.default", pool: "apimart.default",
      baseUrl: "https://api.apimart.ai",
      apiKey: { store: "file", key: "apimart.key" }, modelMap: MODEL_MAP,
      fetch: async () => { throw new Error("不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);

    const videoRequest = need(capabilitySeedance2, generationTypes.videoSet, {
      prompt: ["一只猫"], referenceImage: [{ artifact: { resource: "r1", mediaType: "image/png" }, role: "image" }],
    });
    const videoResolution = registry.resolve(videoRequest);
    expect(videoResolution.status).not.toBe("resolved");

    const imageRequest = need(capabilityGptImage2, generationTypes.imageSet, {
      prompt: ["一只猫"], images: [{ artifact: { resource: "r1", mediaType: "image/png" }, role: "image" }],
    });
    const imageResolution = registry.resolve(imageRequest);
    expect(imageResolution.status).not.toBe("resolved");
  });
});
