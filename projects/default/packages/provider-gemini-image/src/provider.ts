import { canonicalize, defineEndpointPackage } from "@hypit/hypit/endpoint-kit";
import type { CredentialRef, EndpointInvocationContext, EndpointRequest, EndpointSupport } from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedImageSet } from "@hypit/hypit/generation";
import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-gemini-image", version: "1" } as const;
const capabilityModule = { name: "@hypit/nano-banana", version: "1" } as const;
export const capabilityNanoBanana2 = { module: capabilityModule, name: "nano-banana-2" } as const;
export const capabilityNanoBananaPro = { module: capabilityModule, name: "nano-banana-pro" } as const;

// Gemini image generation's documented aspect ratios (ai.google.dev/gemini-api/docs/image-generation).
const SUPPORTED_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const SUPPORTED_RESOLUTIONS = ["1K", "2K", "4K"] as const;
const SUPPORTED_PORTS = ["prompt", "images", "aspectRatio", "resolution", "outputFormat"] as const;

function redactSecrets(message: string): string {
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
  if (!(SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
    return {
      status: "unsupported",
      reason: `不支持的宽高比 ${aspectRatio}，Gemini 仅支持 ${SUPPORTED_ASPECT_RATIOS.join("、")}`,
    };
  }
  const resolution = ports.resolution?.[0];
  if (resolution !== undefined) {
    if (!(SUPPORTED_RESOLUTIONS as readonly string[]).includes(String(resolution))) {
      return { status: "unsupported", reason: `不支持的分辨率 ${String(resolution)}，Gemini 仅支持 1K、2K、4K` };
    }
    if (request.capability.name === "nano-banana-2" && resolution !== "1K") {
      return { status: "unsupported", reason: `nano-banana-2 仅支持分辨率 1K，收到 ${String(resolution)}` };
    }
  }
  return { status: "supported" };
}

export type CreateGeminiImageProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  modelMap: Readonly<Record<string, string>>; concurrency?: number; requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createGeminiImageProvider(options: CreateGeminiImageProviderOptions) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;

  function makeHandler(capabilityName: string) {
    return async function handler(context: EndpointInvocationContext) {
      const supported = support(context.need);
      if (supported.status === "unsupported") throw new Error(supported.reason);

      const model = options.modelMap[capabilityName];
      if (typeof model !== "string" || model.length === 0) {
        throw new Error(`请在配置中填写 Gemini 模型 ID（modelMap.${capabilityName}）`);
      }

      const ports = requestPorts(context.need);
      const prompt = ports.prompt?.[0];
      if (typeof prompt !== "string" || prompt.length === 0) throw new Error("Gemini 图像请求缺少 prompt");
      const aspectRatio = ports.aspectRatio?.[0];
      const resolution = ports.resolution?.[0];
      const images = (ports.images ?? []) as readonly GenerationMediaValue[];
      const secret = context.credentials.apiKey?.secret;
      if (typeof secret !== "string" || secret.length === 0) throw new Error("缺少 Gemini API Key");

      await context.reportProgress?.({ phase: "提交 Gemini 图像请求" });

      const parts: Array<Record<string, unknown>> = [{ text: prompt }];
      for (const image of images) {
        const bytes = await context.resources.get(image.artifact.resource);
        if (bytes === undefined) throw new Error("参考图字节不可用");
        parts.push({ inline_data: { mime_type: image.artifact.mediaType, data: Buffer.from(bytes).toString("base64") } });
      }

      const imageConfig: Record<string, unknown> = {};
      if (aspectRatio !== undefined) imageConfig.aspectRatio = aspectRatio;
      if (resolution !== undefined) imageConfig.imageSize = resolution;

      const response = await fetcher(`${base}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": secret },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
          },
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (!response.ok) {
        let detail = "";
        try {
          const errorBody = await response.json() as { error?: { message?: unknown } };
          if (typeof errorBody.error?.message === "string" && errorBody.error.message.length > 0) detail = `：${errorBody.error.message}`;
        } catch { /* Non-JSON error bodies leave only the HTTP status. */ }
        throw new Error(redactSecrets(`Gemini 图像服务返回 HTTP ${response.status}${detail}`));
      }

      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: unknown; data?: unknown } }> } }>;
      };
      const responseParts = body.candidates?.[0]?.content?.parts ?? [];
      const artifacts = [];
      for (const part of responseParts) {
        const inlineData = part.inlineData;
        if (inlineData === undefined) continue;
        const data = inlineData.data;
        if (typeof data !== "string" || data.length === 0) continue;
        const mediaType = typeof inlineData.mimeType === "string" && inlineData.mimeType.length > 0 ? inlineData.mimeType : "image/png";
        const bytes = Buffer.from(data, "base64");
        artifacts.push(await context.resources.put(new Uint8Array(bytes), mediaType));
      }
      if (artifacts.length === 0) throw new Error("Gemini 未返回图像（可能被安全策略拦截）");
      return { value: { kind: "inline" as const, value: canonicalize(sealGeneratedImageSet({ images: artifacts })) } };
    };
  }

  return defineEndpointPackage({
    module: providerModule, facet: "images",
    instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "Gemini API Key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 2 } },
    pricing: { kind: "page", url: "https://ai.google.dev/gemini-api/docs/pricing" },
    capabilities: [
      {
        capability: capabilityNanoBanana2, returns: generationTypes.imageSet, lifecycle: "immediate",
        supports: support,
        handler: makeHandler(capabilityNanoBanana2.name),
      },
      {
        capability: capabilityNanoBananaPro, returns: generationTypes.imageSet, lifecycle: "immediate",
        supports: support,
        handler: makeHandler(capabilityNanoBananaPro.name),
      },
    ],
  });
}
