import { canonicalize, defineEndpointPackage } from "@hypit/hypit/endpoint-kit";
import type { CredentialRef, EndpointInvocationContext, EndpointRequest, EndpointSupport } from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedImageSet } from "@hypit/hypit/generation";
import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-openai-image", version: "1" } as const;
export const capability = { module: { name: "@hypit/gpt-image", version: "1" }, name: "gpt-image-2" } as const;

// GPT Image 2 declares 16 aspect ratios; this OpenAI-compatible /v1/images endpoint only
// accepts the three fixed sizes below, so every other ratio is rejected in supports().
const ASPECT_RATIO_TO_SIZE: Readonly<Record<string, string>> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

const SUPPORTED_PORTS = ["prompt", "aspectRatio", "resolution", "background", "images"] as const;

function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

function requestPorts(request: EndpointRequest): Readonly<Record<string, readonly unknown[]>> {
  return (request.constraints as unknown as GenerationRequest).ports;
}

export function support(request: EndpointRequest): EndpointSupport {
  const ports = requestPorts(request);
  const unknownPort = Object.keys(ports).find((port) => !(SUPPORTED_PORTS as readonly string[]).includes(port));
  if (unknownPort !== undefined) {
    return { status: "unsupported", reason: `不支持的输入端口：${unknownPort}` };
  }
  const aspectRatio = String(ports.aspectRatio?.[0] ?? "1:1");
  if (!Object.hasOwn(ASPECT_RATIO_TO_SIZE, aspectRatio)) {
    return { status: "unsupported", reason: `不支持的宽高比 ${aspectRatio}，此服务仅支持 1:1、3:2、2:3` };
  }
  const resolution = ports.resolution?.[0];
  if (resolution !== undefined && resolution !== "1K") {
    return { status: "unsupported", reason: `不支持的分辨率 ${String(resolution)}，此服务仅支持 1K` };
  }
  const images = ports.images ?? [];
  if (images.length > 16) {
    return { status: "unsupported", reason: `参考图数量 ${images.length} 张超过 16 张上限` };
  }
  return { status: "supported" };
}

export type CreateOpenAiImageProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  wireModel: string; concurrency?: number; requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createOpenAiImageProvider(options: CreateOpenAiImageProviderOptions) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;

  async function handler(context: EndpointInvocationContext) {
    const supported = support(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);

    const ports = requestPorts(context.need);
    const prompt = ports.prompt?.[0];
    if (typeof prompt !== "string" || prompt.length === 0) throw new Error("OpenAI 图像请求缺少 prompt");
    const aspectRatio = String(ports.aspectRatio?.[0] ?? "1:1");
    const size = ASPECT_RATIO_TO_SIZE[aspectRatio]!;
    const background = ports.background?.[0];
    const images = (ports.images ?? []) as readonly GenerationMediaValue[];
    const secret = context.credentials.apiKey?.secret;
    if (typeof secret !== "string" || secret.length === 0) throw new Error("缺少 OpenAI 兼容服务 API Key");

    await context.reportProgress?.({ phase: "提交 OpenAI 图像请求" });

    let response: Response;
    if (images.length === 0) {
      response = await fetcher(`${base}/v1/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          model: options.wireModel, prompt, size, n: 1,
          ...(typeof background === "string" ? { background } : {}),
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } else {
      const form = new FormData();
      form.set("model", options.wireModel);
      form.set("prompt", prompt);
      form.set("size", size);
      if (typeof background === "string") form.set("background", background);
      // The official /v1/images/edits multipart contract repeats the `image[]` field per file,
      // regardless of count (see docs/superpowers/sdd/2026-09-17-direct-providers/task-2-report.md).
      for (const image of images) {
        const bytes = await context.resources.get(image.artifact.resource);
        if (bytes === undefined) throw new Error("参考图字节不可用");
        form.append("image[]", new Blob([Buffer.from(bytes)], { type: image.artifact.mediaType }));
      }
      response = await fetcher(`${base}/v1/images/edits`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: form,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    }

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json() as { error?: { message?: unknown } };
        if (typeof body.error?.message === "string" && body.error.message.length > 0) detail = `：${body.error.message}`;
      } catch { /* Non-JSON error bodies leave only the HTTP status. */ }
      throw new Error(redactUrls(`OpenAI 图像服务返回 HTTP ${response.status}${detail}`));
    }

    const body = await response.json() as { data?: Array<{ b64_json?: unknown }> };
    const b64 = body.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || b64.length === 0) throw new Error("OpenAI 图像服务响应缺少 b64_json 字段");
    const bytes = Buffer.from(b64, "base64");
    const artifact = await context.resources.put(new Uint8Array(bytes), "image/png");
    return { value: { kind: "inline" as const, value: canonicalize(sealGeneratedImageSet({ images: [artifact] })) } };
  }

  return defineEndpointPackage({
    module: providerModule, facet: "images",
    instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "OpenAI 兼容服务 API Key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 2 } },
    pricing: { kind: "page", url: "https://platform.openai.com/docs/pricing" },
    capabilities: [{
      capability, returns: generationTypes.imageSet, lifecycle: "immediate",
      supports: support,
      handler,
    }],
  });
}
