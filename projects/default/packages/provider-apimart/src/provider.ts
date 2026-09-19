import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import type {
  AsyncEndpoint,
  CredentialRef,
  EndpointOutcome,
  EndpointPollContext,
  EndpointRequest,
  EndpointStartContext,
  EndpointSupport,
} from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedImageSet, sealGeneratedVideoSet } from "@hypit/hypit/generation";
import type { GenerationRequest } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-apimart", version: "1" } as const;
const seedanceModule = { name: "@hypit/seedance", version: "1" } as const;
const gptImageModule = { name: "@hypit/gpt-image", version: "1" } as const;

export const capabilitySeedance2 = { module: seedanceModule, name: "seedance-2" } as const;
export const capabilitySeedance2Fast = { module: seedanceModule, name: "seedance-2-fast" } as const;
export const capabilitySeedance2Mini = { module: seedanceModule, name: "seedance-2-mini" } as const;
export const capabilitySeedance25 = { module: seedanceModule, name: "seedance-2.5" } as const;
export const capabilityGptImage2 = { module: gptImageModule, name: "gpt-image-2" } as const;

const SEEDANCE_CAPABILITIES = [
  capabilitySeedance2,
  capabilitySeedance2Fast,
  capabilitySeedance2Mini,
  capabilitySeedance25,
] as const;

const HANDLE_CONTRACT = "workbench.apimart-task@1" as const;

type ApimartHandle = {
  readonly contract: typeof HANDLE_CONTRACT;
  readonly taskId: string;
  readonly capability: string;
  readonly startedAt: number;
};

// APIMart 视频生成图片参考格式未经实测确认（brief），因此 firstFrame/lastFrame/referenceImage/
// referenceVideo/referenceAudio/webSearch 一律 unsupported——宁窄勿错。
const SEEDANCE_UNSUPPORTED_PORTS = new Set([
  "firstFrame", "lastFrame", "referenceImage", "referenceVideo", "referenceAudio", "webSearch",
]);
const SEEDANCE_SUPPORTED_PORTS = new Set(["prompt", "resolution", "aspectRatio", "duration", "generateAudio"]);

// APIMart 图生图（images 参考端口）格式同样未经实测确认，一律 unsupported。
const GPT_IMAGE_UNSUPPORTED_PORTS = new Set(["images", "background"]);
const GPT_IMAGE_SUPPORTED_PORTS = new Set(["prompt", "aspectRatio", "resolution"]);

function redactSecrets(message: string): string {
  return message.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

function requestPorts(request: EndpointRequest): Readonly<Record<string, readonly unknown[]>> {
  return (request.constraints as unknown as GenerationRequest).ports;
}

function modelMissingMessage(capabilityName: string): string {
  return `APIMart 模型 ID 未配置：请确认已开通的模型 ID，并填入配置 modelMap.${capabilityName}`;
}

export function seedanceSupport(request: EndpointRequest): EndpointSupport {
  const ports = requestPorts(request);
  for (const port of Object.keys(ports)) {
    if (SEEDANCE_UNSUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `APIMart 暂不支持该输入（参考图/参考视频/参考音频/联网搜索格式未验证）：${port}` };
    }
    if (!SEEDANCE_SUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `不支持的输入端口：${port}` };
    }
  }
  return { status: "supported" };
}

export function gptImageSupport(request: EndpointRequest): EndpointSupport {
  const ports = requestPorts(request);
  for (const port of Object.keys(ports)) {
    if (GPT_IMAGE_UNSUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `APIMart 图生图/背景参数格式未验证，暂不支持该输入：${port}` };
    }
    if (!GPT_IMAGE_SUPPORTED_PORTS.has(port)) {
      return { status: "unsupported", reason: `不支持的输入端口：${port}` };
    }
  }
  return { status: "supported" };
}

function apiMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const candidates = [record.message, record.msg, (record.error as Record<string, unknown> | undefined)?.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = apiMessage(body);
    if (message !== undefined) return `：${message}`;
  } catch { /* Non-JSON error bodies leave only the HTTP status. */ }
  return "";
}

type ApimartTaskData = {
  id?: unknown;
  status?: unknown;
  message?: unknown;
  result?: {
    videos?: Array<{ url?: unknown[] }>;
    images?: Array<{ url?: unknown[] }>;
  };
};

type ApimartResponseBody = {
  code?: unknown;
  message?: unknown;
  data?: unknown;
};

export type CreateApimartProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  modelMap: Readonly<Record<string, string>>;
  concurrency?: number; pollIntervalMs?: number; requestTimeoutMs?: number; maxOperationMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createApimartProvider(options: CreateApimartProviderOptions) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 8_000;
  const maxOperationMs = options.maxOperationMs ?? 20 * 60_000;

  function failure(error: unknown, code = "APIMART_REQUEST_FAILED"): { status: "failed"; failure: { code: string; message: string } } {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", failure: { code, message: redactSecrets(message) } };
  }

  async function apiKeySecret(context: { credentials: { apiKey?: { secret?: unknown } } }): Promise<string> {
    const secret = context.credentials.apiKey?.secret;
    if (typeof secret !== "string" || secret.length === 0) throw new Error("缺少 APIMart API Key");
    return secret;
  }

  async function submitTask(
    context: EndpointStartContext,
    capabilityName: string,
    path: string,
    buildBody: (model: string, ports: Readonly<Record<string, readonly unknown[]>>) => Record<string, unknown>,
  ): Promise<EndpointOutcome> {
    try {
      const model = options.modelMap[capabilityName];
      if (typeof model !== "string" || model.length === 0) {
        return { status: "failed", failure: { code: "APIMART_MODEL_ID_MISSING", message: modelMissingMessage(capabilityName) } };
      }

      const ports = requestPorts(context.need);
      const prompt = ports.prompt?.[0];
      if (typeof prompt !== "string" || prompt.length === 0) return failure(new Error("APIMart 生成请求缺少 prompt"));
      const secret = await apiKeySecret(context);
      const body = buildBody(model, ports);

      await context.reportProgress?.({ phase: "提交 APIMart 生成任务" });

      const response = await fetcher(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (!response.ok) {
        const detail = await errorDetail(response);
        return failure(new Error(`APIMart 服务返回 HTTP ${response.status}${detail}`));
      }

      const json = await response.json() as ApimartResponseBody;
      if (json.code !== 200) {
        const detail = apiMessage(json);
        return failure(new Error(`APIMart 服务返回错误码 ${String(json.code)}${detail !== undefined ? `：${detail}` : ""}`));
      }
      const first = Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined;
      const taskId = first?.task_id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        return failure(new Error("APIMart 服务响应缺少 task_id"));
      }

      const handle = canonicalize({
        contract: HANDLE_CONTRACT, taskId, capability: capabilityName, startedAt: Date.now(),
      } satisfies ApimartHandle);
      const receipt = { id: taskId };
      await context.checkpoint?.({ handle, receipt });
      return { ...wakeAfter(handle, pollIntervalMs, Date.now(), { phase: "queued" }), receipt };
    } catch (error) {
      return failure(error);
    }
  }

  async function fetchTask(secret: string, taskId: string): Promise<{ ok: true; data: ApimartTaskData } | { ok: false; outcome: EndpointOutcome }> {
    const response = await fetcher(`${base}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      const detail = await errorDetail(response);
      return { ok: false, outcome: failure(new Error(`APIMart 服务返回 HTTP ${response.status}${detail}`)) };
    }
    const json = await response.json() as ApimartResponseBody;
    if (json.code !== 200) {
      const detail = apiMessage(json);
      return { ok: false, outcome: failure(new Error(`APIMart 服务返回错误码 ${String(json.code)}${detail !== undefined ? `：${detail}` : ""}`)) };
    }
    return { ok: true, data: (json.data ?? {}) as ApimartTaskData };
  }

  async function pollTask(context: EndpointPollContext): Promise<EndpointOutcome> {
    try {
      const handle = context.handle as unknown as ApimartHandle;
      if (handle?.contract !== HANDLE_CONTRACT) throw new Error("APIMart 任务句柄无效");
      if (Date.now() - handle.startedAt > maxOperationMs) {
        return {
          status: "failed",
          receipt: { id: handle.taskId },
          failure: {
            code: "APIMART_OPERATION_TIMEOUT",
            message: `APIMart 生成任务 ${handle.taskId} 超过本地等待时限（${maxOperationMs}ms），远端结果未知`,
          },
        };
      }
      const secret = await apiKeySecret(context);
      const fetched = await fetchTask(secret, handle.taskId);
      if (!fetched.ok) return fetched.outcome;
      const status = fetched.data.status;
      if (status === "submitted" || status === "processing") {
        return { ...wakeAfter(context.handle, pollIntervalMs, Date.now(), { phase: String(status) }), receipt: { id: handle.taskId } };
      }
      if (status === "failed") {
        const message = apiMessage(fetched.data);
        const detail = message !== undefined ? `：${message}` : "";
        return {
          status: "failed",
          receipt: { id: handle.taskId },
          failure: { code: "APIMART_TASK_FAILED", message: redactSecrets(`APIMart 生成任务失败${detail}`) },
        };
      }
      if (status !== "completed") throw new Error(`APIMart 返回未知任务状态 ${String(status)}`);
      return { status: "ready", handle: context.handle, receipt: { id: handle.taskId } };
    } catch (error) {
      return failure(error);
    }
  }

  async function collectVideo(context: EndpointPollContext): Promise<EndpointOutcome> {
    try {
      const handle = context.handle as unknown as ApimartHandle;
      const secret = await apiKeySecret(context);
      const fetched = await fetchTask(secret, handle.taskId);
      if (!fetched.ok) return fetched.outcome;
      const url = fetched.data.result?.videos?.[0]?.url?.[0];
      if (typeof url !== "string" || url.length === 0) {
        return failure(new Error("APIMart 视频生成任务响应缺少 result.videos[0].url[0]"));
      }
      // 签名 URL 下载不带 Authorization（brief）。
      const videoResponse = await fetcher(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
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
  }

  function sniffImageMediaType(bytes: Uint8Array): string {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return "image/webp";
    }
    return "image/png";
  }

  async function collectImage(context: EndpointPollContext): Promise<EndpointOutcome> {
    try {
      const handle = context.handle as unknown as ApimartHandle;
      const secret = await apiKeySecret(context);
      const fetched = await fetchTask(secret, handle.taskId);
      if (!fetched.ok) return fetched.outcome;
      const images = fetched.data.result?.images ?? [];
      if (images.length === 0) {
        return failure(new Error("APIMart 图片生成任务响应缺少 result.images"));
      }
      const artifacts = [];
      for (const image of images) {
        const url = image.url?.[0];
        if (typeof url !== "string" || url.length === 0) {
          return failure(new Error("APIMart 图片生成任务响应缺少 result.images[].url[0]"));
        }
        // 签名 URL 下载不带 Authorization（brief）。
        const imageResponse = await fetcher(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
        if (!imageResponse.ok) {
          return failure(new Error(redactSecrets(`下载生成图片失败：HTTP ${imageResponse.status}`)));
        }
        const bytes = new Uint8Array(await imageResponse.arrayBuffer());
        artifacts.push(await context.resources.put(bytes, sniffImageMediaType(bytes)));
      }
      return {
        status: "completed",
        result: { value: { kind: "inline" as const, value: canonicalize(sealGeneratedImageSet({ images: artifacts })) } },
      };
    } catch (error) {
      return failure(error);
    }
  }

  function makeSeedanceEndpoint(capabilityName: string): AsyncEndpoint {
    return {
      async start(context: EndpointStartContext): Promise<EndpointOutcome> {
        const supported = seedanceSupport(context.need);
        if (supported.status === "unsupported") return failure(new Error(supported.reason));
        return submitTask(context, capabilityName, "/v1/videos/generations", (model, ports) => {
          const body: Record<string, unknown> = { model, prompt: ports.prompt?.[0] };
          const resolution = ports.resolution?.[0];
          if (resolution !== undefined) body.resolution = resolution;
          const aspectRatio = ports.aspectRatio?.[0];
          if (aspectRatio !== undefined) body.size = aspectRatio;
          const duration = ports.duration?.[0];
          if (duration !== undefined) body.duration = duration;
          const generateAudio = ports.generateAudio?.[0];
          if (generateAudio !== undefined) body.generate_audio = generateAudio;
          return body;
        });
      },
      poll: pollTask,
      collect: collectVideo,
    };
  }

  function makeGptImageEndpoint(capabilityName: string): AsyncEndpoint {
    return {
      async start(context: EndpointStartContext): Promise<EndpointOutcome> {
        const supported = gptImageSupport(context.need);
        if (supported.status === "unsupported") return failure(new Error(supported.reason));
        return submitTask(context, capabilityName, "/v1/images/generations", (model, ports) => {
          const body: Record<string, unknown> = { model, prompt: ports.prompt?.[0], n: 1 };
          const aspectRatio = ports.aspectRatio?.[0];
          if (aspectRatio !== undefined) body.size = aspectRatio;
          const resolution = ports.resolution?.[0];
          if (resolution !== undefined) body.resolution = String(resolution).toLowerCase();
          return body;
        });
      },
      poll: pollTask,
      collect: collectImage,
    };
  }

  return defineEndpointPackage({
    module: providerModule, facet: "generation",
    instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "APIMart API Key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 1 } },
    pricing: { kind: "page", url: "https://api.apimart.ai" },
    capabilities: [
      ...SEEDANCE_CAPABILITIES.map((capability) => ({
        capability, returns: generationTypes.videoSet, lifecycle: "asynchronous" as const,
        supports: seedanceSupport,
        endpoint: makeSeedanceEndpoint(capability.name),
      })),
      {
        capability: capabilityGptImage2, returns: generationTypes.imageSet, lifecycle: "asynchronous" as const,
        supports: gptImageSupport,
        endpoint: makeGptImageEndpoint(capabilityGptImage2.name),
      },
    ],
  });
}
