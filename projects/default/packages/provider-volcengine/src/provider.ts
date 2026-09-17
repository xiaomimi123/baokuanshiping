import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import type {
  AsyncEndpoint,
  CredentialRef,
  EndpointInvocationContext,
  EndpointOutcome,
  EndpointPollContext,
  EndpointRequest,
  EndpointStartContext,
  EndpointSupport,
} from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedImageSet, sealGeneratedVideoSet } from "@hypit/hypit/generation";
import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-volcengine", version: "1" } as const;
const seedanceModule = { name: "@hypit/seedance", version: "1" } as const;
const seedreamModule = { name: "@hypit/seedream", version: "1" } as const;

export const capabilitySeedance2 = { module: seedanceModule, name: "seedance-2" } as const;
export const capabilitySeedance2Fast = { module: seedanceModule, name: "seedance-2-fast" } as const;
export const capabilitySeedance2Mini = { module: seedanceModule, name: "seedance-2-mini" } as const;
export const capabilitySeedance25 = { module: seedanceModule, name: "seedance-2.5" } as const;
export const capabilitySeedream5Lite = { module: seedreamModule, name: "seedream-5-lite" } as const;

const SEEDANCE_CAPABILITIES = [
  capabilitySeedance2,
  capabilitySeedance2Fast,
  capabilitySeedance2Mini,
  capabilitySeedance25,
] as const;

const HANDLE_CONTRACT = "workbench.volcengine-task@1" as const;

type VolcengineHandle = {
  readonly contract: typeof HANDLE_CONTRACT;
  readonly taskId: string;
  readonly capability: string;
  readonly startedAt: number;
};

// Seedance 支持面：方舟直连暂不承接 referenceVideo/referenceAudio/webSearch（brief §5）。
const SEEDANCE_UNSUPPORTED_PORTS = new Set(["referenceVideo", "referenceAudio", "webSearch"]);
const SEEDANCE_SUPPORTED_PORTS = new Set([
  "prompt", "firstFrame", "lastFrame", "referenceImage", "resolution", "aspectRatio", "duration", "generateAudio",
]);

// Seedream 支持面：nsfwCheck 接受但忽略（不影响请求）。
const SEEDREAM_SUPPORTED_PORTS = new Set([
  "prompt", "aspectRatio", "quality", "outputFormat", "images", "nsfwCheck",
]);

// basic/high/ultra 档位换算方舟 size 取值（brief §5：basic→1K、high→2K、ultra→4K）。
const QUALITY_TO_SIZE: Readonly<Record<string, string>> = { basic: "1K", high: "2K", ultra: "4K" };

function redactSecrets(message: string): string {
  return message.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

function requestPorts(request: EndpointRequest): Readonly<Record<string, readonly unknown[]>> {
  return (request.constraints as unknown as GenerationRequest).ports;
}

function modelMissingMessage(capabilityName: string): string {
  return `方舟模型 ID 未配置：请到方舟控制台确认已开通的模型 ID，并填入配置 modelMap.${capabilityName}`;
}

export function seedanceSupport(request: EndpointRequest): EndpointSupport {
  const ports = requestPorts(request);
  for (const port of Object.keys(ports)) {
    if (SEEDANCE_UNSUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `方舟直连暂不支持该输入：${port}` };
    }
    if (!SEEDANCE_SUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `不支持的输入端口：${port}` };
    }
  }
  return { status: "supported" };
}

export function seedreamSupport(request: EndpointRequest): EndpointSupport {
  const ports = requestPorts(request);
  for (const port of Object.keys(ports)) {
    if (!SEEDREAM_SUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `不支持的输入端口：${port}` };
    }
  }
  return { status: "supported" };
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } } | { message?: unknown };
    const message = (body as { error?: { message?: unknown } }).error?.message ?? (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return `：${message}`;
  } catch { /* Non-JSON error bodies leave only the HTTP status. */ }
  return "";
}

export type CreateVolcengineProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  modelMap: Readonly<Record<string, string>>;
  concurrency?: number; pollIntervalMs?: number; requestTimeoutMs?: number; maxOperationMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createVolcengineProvider(options: CreateVolcengineProviderOptions) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 8_000;
  const maxOperationMs = options.maxOperationMs ?? 20 * 60_000;

  function failure(error: unknown, code = "VOLC_REQUEST_FAILED"): { status: "failed"; failure: { code: string; message: string } } {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", failure: { code, message: redactSecrets(message) } };
  }

  async function apiKeySecret(context: EndpointInvocationContext): Promise<string> {
    const secret = context.credentials.apiKey?.secret;
    if (typeof secret !== "string" || secret.length === 0) throw new Error("缺少方舟 API Key");
    return secret;
  }

  function makeSeedanceEndpoint(capabilityName: string): AsyncEndpoint {
    return {
      async start(context: EndpointStartContext): Promise<EndpointOutcome> {
        try {
          const supported = seedanceSupport(context.need);
          if (supported.status === "unsupported") return failure(new Error(supported.reason));

          const model = options.modelMap[capabilityName];
          if (typeof model !== "string" || model.length === 0) {
            return { status: "failed", failure: { code: "VOLC_MODEL_ID_MISSING", message: modelMissingMessage(capabilityName) } };
          }

          const ports = requestPorts(context.need);
          const prompt = ports.prompt?.[0];
          if (typeof prompt !== "string" || prompt.length === 0) return failure(new Error("方舟视频生成请求缺少 prompt"));
          const secret = await apiKeySecret(context);

          const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
          const mediaPorts: ReadonlyArray<{ port: string; role: "first_frame" | "last_frame" | "reference_image" }> = [
            { port: "firstFrame", role: "first_frame" },
            { port: "lastFrame", role: "last_frame" },
            { port: "referenceImage", role: "reference_image" },
          ];
          for (const { port, role } of mediaPorts) {
            const items = (ports[port] ?? []) as readonly GenerationMediaValue[];
            for (const item of items) {
              const bytes = await context.resources.get(item.artifact.resource);
              if (bytes === undefined) return failure(new Error("参考图字节不可用"));
              const b64 = Buffer.from(bytes).toString("base64");
              content.push({ type: "image_url", image_url: { url: `data:${item.artifact.mediaType};base64,${b64}` }, role });
            }
          }

          // 方舟"创建视频生成任务"文档：resolution/ratio/duration/generate_audio 既可作为顶层 JSON
          // 字段传入，也支持在文本提示词后追加 --rs/--rt/--dur 等弱校验后缀；本实现采用顶层字段，
          // 详见任务报告中的字段核对结论。
          const body: Record<string, unknown> = { model, content };
          const resolution = ports.resolution?.[0];
          if (resolution !== undefined) body.resolution = resolution;
          const aspectRatio = ports.aspectRatio?.[0];
          if (aspectRatio !== undefined) body.ratio = aspectRatio;
          const duration = ports.duration?.[0];
          if (duration !== undefined) body.duration = duration;
          const generateAudio = ports.generateAudio?.[0];
          if (generateAudio !== undefined) body.generate_audio = generateAudio;

          await context.reportProgress?.({ phase: "提交方舟视频生成任务" });

          const response = await fetcher(`${base}/api/v3/contents/generations/tasks`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(requestTimeoutMs),
          });

          if (!response.ok) {
            const detail = await errorDetail(response);
            return failure(new Error(`方舟视频生成服务返回 HTTP ${response.status}${detail}`));
          }

          const json = await response.json() as { id?: unknown };
          const taskId = json.id;
          if (typeof taskId !== "string" || taskId.length === 0) {
            return failure(new Error("方舟视频生成服务响应缺少任务 id"));
          }

          const handle = canonicalize({
            contract: HANDLE_CONTRACT, taskId, capability: capabilityName, startedAt: Date.now(),
          } satisfies VolcengineHandle);
          const receipt = { id: taskId };
          await context.checkpoint?.({ handle, receipt });
          return { ...wakeAfter(handle, pollIntervalMs, Date.now(), { phase: "queued" }), receipt };
        } catch (error) {
          return failure(error);
        }
      },

      async poll(context: EndpointPollContext): Promise<EndpointOutcome> {
        try {
          const handle = context.handle as unknown as VolcengineHandle;
          if (handle?.contract !== HANDLE_CONTRACT) throw new Error("方舟任务句柄无效");
          if (Date.now() - handle.startedAt > maxOperationMs) {
            return {
              status: "failed",
              receipt: { id: handle.taskId },
              failure: {
                code: "VOLC_OPERATION_TIMEOUT",
                message: `方舟视频生成任务 ${handle.taskId} 超过本地等待时限（${maxOperationMs}ms），远端结果未知`,
              },
            };
          }
          const secret = await apiKeySecret(context);
          const response = await fetcher(`${base}/api/v3/contents/generations/tasks/${encodeURIComponent(handle.taskId)}`, {
            method: "GET",
            headers: { authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (!response.ok) {
            const detail = await errorDetail(response);
            return failure(new Error(`方舟视频生成服务返回 HTTP ${response.status}${detail}`));
          }
          const job = await response.json() as { status?: unknown; error?: { message?: unknown } | null };
          const status = job.status;
          if (status === "queued" || status === "running") {
            return { ...wakeAfter(context.handle, pollIntervalMs, Date.now(), { phase: String(status) }), receipt: { id: handle.taskId } };
          }
          if (status === "failed" || status === "cancelled") {
            const message = job.error?.message;
            const detail = typeof message === "string" && message.length > 0 ? `：${message}` : "";
            return {
              status: "failed",
              receipt: { id: handle.taskId },
              failure: { code: "VOLC_TASK_FAILED", message: redactSecrets(`方舟视频生成任务失败${detail}`) },
            };
          }
          if (status !== "succeeded") throw new Error(`方舟返回未知任务状态 ${String(status)}`);
          return { status: "ready", handle: context.handle, receipt: { id: handle.taskId } };
        } catch (error) {
          return failure(error);
        }
      },

      async collect(context: EndpointPollContext): Promise<EndpointOutcome> {
        try {
          const handle = context.handle as unknown as VolcengineHandle;
          const secret = await apiKeySecret(context);
          const response = await fetcher(`${base}/api/v3/contents/generations/tasks/${encodeURIComponent(handle.taskId)}`, {
            method: "GET",
            headers: { authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (!response.ok) {
            const detail = await errorDetail(response);
            return failure(new Error(`方舟视频生成服务返回 HTTP ${response.status}${detail}`));
          }
          const job = await response.json() as { content?: { video_url?: unknown } };
          const videoUrl = job.content?.video_url;
          if (typeof videoUrl !== "string" || videoUrl.length === 0) {
            return failure(new Error("方舟视频生成任务响应缺少 video_url"));
          }
          // video_url 是签名 URL，下载时不带 Authorization（brief §6）。
          const videoResponse = await fetcher(videoUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
          if (!videoResponse.ok) {
            return failure(new Error(redactSecrets(`下载生成视频失败：HTTP ${videoResponse.status}`)));
          }
          const bytes = new Uint8Array(await videoResponse.arrayBuffer());
          const artifact = await context.resources.put(bytes, "video/mp4");
          return {
            status: "completed",
            result: { value: { kind: "inline" as const, value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } },
          };
        } catch (error) {
          return failure(error);
        }
      },
    };
  }

  async function seedreamHandler(context: EndpointInvocationContext) {
    const supported = seedreamSupport(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);

    const model = options.modelMap[capabilitySeedream5Lite.name];
    if (typeof model !== "string" || model.length === 0) {
      throw new Error(modelMissingMessage(capabilitySeedream5Lite.name));
    }

    const ports = requestPorts(context.need);
    const prompt = ports.prompt?.[0];
    if (typeof prompt !== "string" || prompt.length === 0) throw new Error("方舟图像生成请求缺少 prompt");
    const quality = String(ports.quality?.[0] ?? "basic");
    const size = QUALITY_TO_SIZE[quality] ?? QUALITY_TO_SIZE.basic;
    const images = (ports.images ?? []) as readonly GenerationMediaValue[];
    const secret = await apiKeySecret(context);

    const imageDataUrls: string[] = [];
    for (const image of images) {
      const bytes = await context.resources.get(image.artifact.resource);
      if (bytes === undefined) throw new Error("参考图字节不可用");
      imageDataUrls.push(`data:${image.artifact.mediaType};base64,${Buffer.from(bytes).toString("base64")}`);
    }

    await context.reportProgress?.({ phase: "提交方舟图像生成请求" });

    const body: Record<string, unknown> = {
      model, prompt, size, response_format: "b64_json", watermark: false,
      ...(imageDataUrls.length > 0 ? { image: imageDataUrls } : {}),
    };

    const response = await fetcher(`${base}/api/v3/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new Error(redactSecrets(`方舟图像生成服务返回 HTTP ${response.status}${detail}`));
    }

    const json = await response.json() as { data?: Array<{ b64_json?: unknown }> };
    const b64 = json.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || b64.length === 0) throw new Error("方舟图像生成服务响应缺少 b64_json 字段");
    const bytes = Buffer.from(b64, "base64");
    const artifact = await context.resources.put(new Uint8Array(bytes), "image/png");
    return { value: { kind: "inline" as const, value: canonicalize(sealGeneratedImageSet({ images: [artifact] })) } };
  }

  return defineEndpointPackage({
    module: providerModule, facet: "generation",
    instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "火山引擎方舟 API Key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 1 } },
    pricing: { kind: "page", url: "https://www.volcengine.com/docs/82379/1544681" },
    capabilities: [
      ...SEEDANCE_CAPABILITIES.map((capability) => ({
        capability, returns: generationTypes.videoSet, lifecycle: "asynchronous" as const,
        supports: seedanceSupport,
        endpoint: makeSeedanceEndpoint(capability.name),
      })),
      {
        capability: capabilitySeedream5Lite, returns: generationTypes.imageSet, lifecycle: "immediate" as const,
        supports: seedreamSupport,
        handler: seedreamHandler,
      },
    ],
  });
}
