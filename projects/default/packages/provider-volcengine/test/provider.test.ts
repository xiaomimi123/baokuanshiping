import { describe, expect, it } from "vitest";
import { EndpointRegistry, MemoryResourceStore } from "@hypit/driver-node";
import type { BlobRef, EndpointInvocationContext, EndpointPollContext, EndpointRequest, EndpointStartContext } from "@hypit/hypit/endpoint-kit";
import { canonicalize } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";
import {
  capabilitySeedance2, capabilitySeedream5Lite, createVolcengineProvider,
} from "../src/provider.js";

function need(
  capability: typeof capabilitySeedance2 | typeof capabilitySeedream5Lite,
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
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");
const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

const MODEL_MAP = {
  "seedance-2": "doubao-seedance-2-0-260128",
  "seedance-2-fast": "doubao-seedance-2-0-fast-260128",
  "seedance-2-mini": "doubao-seedance-2-0-mini-260128",
  "seedance-2.5": "doubao-seedance-2-5-260128",
  "seedream-5-lite": "doubao-seedream-5-0-lite-260128",
};

describe("火山引擎（Seedance/Seedream）Provider", () => {
  it("start：请求体含参数后缀（顶层字段）与 firstFrame base64 图片项，Authorization 头正确", async () => {
    const resources = new MemoryResourceStore();
    const firstFrameBytes = new Uint8Array([1, 2, 3, 4]);
    const firstFrameArtifact = await resources.put(firstFrameBytes, "image/png");
    let seenUrl: string | undefined;
    let seenHeaders: Record<string, string> | undefined;
    let seenBody: Record<string, unknown> | undefined;
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        seenUrl = String(input);
        seenHeaders = init?.headers as Record<string, string>;
        seenBody = JSON.parse(String(init?.body));
        return Response.json({ id: "cgt-test-001" });
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
      firstFrame: [{ artifact: firstFrameArtifact, role: "image" }],
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
    expect(seenUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    expect(seenHeaders?.authorization).toBe("Bearer test-key");
    expect(seenBody?.model).toBe("doubao-seedance-2-0-260128");
    expect(seenBody?.resolution).toBe("720p");
    expect(seenBody?.ratio).toBe("16:9");
    expect(seenBody?.duration).toBe(5);
    expect(seenBody?.generate_audio).toBe(false);
    const content = seenBody?.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "text", text: "一只猫在窗台上打哈欠" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${Buffer.from(firstFrameBytes).toString("base64")}` },
      role: "first_frame",
    });
    expect(outcome.status).toBe("pending");
  });

  it("start：成功提交返回 pending 且携带 receipt（任务 id）", async () => {
    const resources = new MemoryResourceStore();
    const checkpoints: unknown[] = [];
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ id: "cgt-test-002" }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const context: EndpointStartContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test",
      checkpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
    };
    const outcome = await resolution.registration.endpoint.start(context);
    expect(outcome.status).toBe("pending");
    expect(outcome.receipt).toEqual({ id: "cgt-test-002" });
    expect(checkpoints).toHaveLength(1);
    expect((checkpoints[0] as { receipt: { id: string } }).receipt).toEqual({ id: "cgt-test-002" });
  });

  it("poll：running 状态返回 pending，succeeded 状态返回 ready", async () => {
    const resources = new MemoryResourceStore();
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async () => { throw new Error("start 阶段不应发起网络请求"); },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const handle = canonicalize({
      contract: "workbench.volcengine-task@1", taskId: "cgt-test-003",
      capability: "seedance-2", startedAt: Date.now(),
    });

    let statusToReturn = "running";
    const pollContextFor = (): EndpointPollContext => ({
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      operation: "op:test", handle,
    });

    const runningProvider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ id: "cgt-test-003", status: statusToReturn }),
    });
    const runningRegistry = new EndpointRegistry();
    await runningProvider.install(runningRegistry);
    const runningResolution = runningRegistry.resolve(request);
    if (runningResolution.status !== "resolved" || runningResolution.registration.kind !== "asynchronous") throw new Error("unreachable");

    const runningOutcome = await runningResolution.registration.endpoint.poll(pollContextFor());
    expect(runningOutcome.status).toBe("pending");

    statusToReturn = "succeeded";
    const readyOutcome = await runningResolution.registration.endpoint.poll(pollContextFor());
    expect(readyOutcome.status).toBe("ready");
  });

  it("collect：从 content.video_url 下载视频字节并落库为 videoSet（下载请求不带 Authorization）", async () => {
    const resources = new MemoryResourceStore();
    let sawAuthorizationOnDownload = false;
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("tos-cn-beijing.volces.com")) {
          if ((init?.headers as Record<string, string> | undefined)?.authorization !== undefined) sawAuthorizationOnDownload = true;
          return new Response(MP4_BYTES, { status: 200 });
        }
        return Response.json({
          id: "cgt-test-004", status: "succeeded",
          content: { video_url: "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/xxx.mp4" },
        });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const handle = canonicalize({
      contract: "workbench.volcengine-task@1", taskId: "cgt-test-004",
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

  it("模型 ID 缺失：Seedance start 返回 failed（VOLC_MODEL_ID_MISSING），Seedream handler 抛同样文案", async () => {
    const resources = new MemoryResourceStore();
    const emptyModelMap = { ...MODEL_MAP, "seedance-2": "", "seedream-5-lite": "" };
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: emptyModelMap,
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
    expect(outcome.failure.code).toBe("VOLC_MODEL_ID_MISSING");
    expect(outcome.failure.message).toContain("modelMap.seedance-2");
    expect(outcome.failure.message).toMatch(/[一-鿿]/u);

    const imageRequest = need(capabilitySeedream5Lite, generationTypes.imageSet, { prompt: ["一只猫"] });
    const imageResolution = registry.resolve(imageRequest);
    if (imageResolution.status !== "resolved" || imageResolution.registration.kind !== "immediate") throw new Error("unreachable");
    const handlerContext: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:test-image", need: imageRequest },
      need: imageRequest, resources, credentials: { apiKey: { secret: "test-key" } },
    };
    await expect(imageResolution.registration.handler(handlerContext)).rejects.toThrow(
      "方舟模型 ID 未配置：请到方舟控制台确认已开通的模型 ID，并填入配置 modelMap.seedream-5-lite",
    );
  });

  it("Seedream immediate 全流程（1:1）：请求体含 size/response_format/watermark，响应 b64_json 落库为 imageSet", async () => {
    const resources = new MemoryResourceStore();
    let seenUrl: string | undefined;
    let seenBody: Record<string, unknown> | undefined;
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async (input, init) => {
        seenUrl = String(input);
        seenBody = JSON.parse(String(init?.body));
        return Response.json({ data: [{ b64_json: PNG_B64 }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedream5Lite, generationTypes.imageSet, {
      prompt: ["一只猫在窗台上"], quality: ["high"],
    });
    const resolution = registry.resolve(request);
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:test", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    expect(seenUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(seenBody?.model).toBe("doubao-seedream-5-0-lite-260128");
    // high 档位对应 3072² 基准像素面积，1:1 时 width=height=3072。
    expect(seenBody?.size).toBe("3072x3072");
    expect(seenBody?.response_format).toBe("b64_json");
    expect(seenBody?.watermark).toBe(false);
    expect(result.value.kind).toBe("inline");
    const images = (result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images).toHaveLength(1);
    expect(images[0]?.mediaType).toBe("image/png");
    expect(await resources.get(images[0]!.resource)).toEqual(PNG_BYTES);
  });

  it("Seedream 档位映射：basic→2048x2048、high→3072x3072、ultra→4096x4096（1:1 时）", async () => {
    const sizesSeen: Record<string, unknown> = {};
    for (const quality of ["basic", "high", "ultra"] as const) {
      const resources = new MemoryResourceStore();
      const provider = createVolcengineProvider({
        instance: "volcengine.default", pool: "volcengine.default",
        baseUrl: "https://ark.cn-beijing.volces.com",
        apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
        fetch: async (_input, init) => {
          sizesSeen[quality] = (JSON.parse(String(init?.body)) as { size: unknown }).size;
          return Response.json({ data: [{ b64_json: PNG_B64 }] });
        },
      });
      const registry = new EndpointRegistry();
      await provider.install(registry);
      const request = need(capabilitySeedream5Lite, generationTypes.imageSet, {
        prompt: ["一只猫"], quality: [quality],
      });
      const resolution = registry.resolve(request);
      if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
      const context: EndpointInvocationContext = {
        command: { kind: "fulfill-need", id: `command:${quality}`, need: request },
        need: request, resources, credentials: { apiKey: { secret: "test-key" } },
      };
      await resolution.registration.handler(context);
    }
    expect(sizesSeen).toEqual({ basic: "2048x2048", high: "3072x3072", ultra: "4096x4096" });
  });

  it("Seedream 非 1:1 宽高比：请求体 size 按 aspectRatio 精确换算像素（不静默丢弃 aspectRatio），outputFormat 映射到 output_format", async () => {
    const resources = new MemoryResourceStore();
    let seenBody: Record<string, unknown> | undefined;
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async (_input, init) => {
        seenBody = JSON.parse(String(init?.body));
        return Response.json({ data: [{ b64_json: PNG_B64 }] });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedream5Lite, generationTypes.imageSet, {
      prompt: ["一只猫在窗台上"], quality: ["basic"], aspectRatio: ["16:9"], outputFormat: ["jpeg"],
    });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:ratio", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
    };
    await resolution.registration.handler(context);
    // basic 档基准面积 2048²=4,194,304；16:9 换算并对齐 16px 网格。
    expect(seenBody?.size).toBe("2736x1536");
    expect(seenBody?.output_format).toBe("jpeg");
  });

  it("Seedream 响应字节是 JPEG 时，mediaType 按 magic bytes 嗅探为 image/jpeg（不信任固定 image/png）", async () => {
    const resources = new MemoryResourceStore();
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
    const b64Jpeg = Buffer.from(jpegBytes).toString("base64");
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ data: [{ b64_json: b64Jpeg }] }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedream5Lite, generationTypes.imageSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:jpeg", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
    };
    const result = await resolution.registration.handler(context);
    const images = (result.value.value as unknown as { images: BlobRef[] }).images;
    expect(images[0]?.mediaType).toBe("image/jpeg");
    expect(await resources.get(images[0]!.resource)).toEqual(jpegBytes);
  });

  it("脱敏：HTTP 错误消息不含 API Key", async () => {
    const resources = new MemoryResourceStore();
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async () => Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedream5Lite, generationTypes.imageSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "immediate") throw new Error("unreachable");
    const context: EndpointInvocationContext = {
      command: { kind: "fulfill-need", id: "command:fail", need: request },
      need: request, resources, credentials: { apiKey: { secret: "test-key" } },
    };
    try {
      await resolution.registration.handler(context);
      throw new Error("expected handler to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("test-key");
    }
  });

  it("脱敏：视频下载失败时签名 URL 被 [redacted-url] 替换", async () => {
    const resources = new MemoryResourceStore();
    const provider = createVolcengineProvider({
      instance: "volcengine.default", pool: "volcengine.default",
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" }, modelMap: MODEL_MAP,
      fetch: async (input) => {
        const url = String(input);
        // 模拟底层网络异常（如 undici 的 fetch failed），错误消息里直接带出请求的签名 URL——
        // 这是签名 URL 真正可能泄漏到日志/错误信息里的路径，而非 HTTP 状态码文案。
        if (url.includes("tos-cn-beijing.volces.com")) throw new Error(`request to ${url} failed, reason: connect ETIMEDOUT`);
        return Response.json({
          id: "cgt-test-005", status: "succeeded",
          content: { video_url: "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/signed?token=test-key-secret" },
        });
      },
    });
    const registry = new EndpointRegistry();
    await provider.install(registry);
    const request = need(capabilitySeedance2, generationTypes.videoSet, { prompt: ["一只猫"] });
    const resolution = registry.resolve(request);
    if (resolution.status !== "resolved" || resolution.registration.kind !== "asynchronous") throw new Error("unreachable");
    const handle = canonicalize({
      contract: "workbench.volcengine-task@1", taskId: "cgt-test-005",
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
});
