import { defineEndpointPackage } from "@hypit/hypit/endpoint-kit";
import type { CredentialRef, EndpointRequest } from "@hypit/hypit/endpoint-kit";
import { generationTypes } from "@hypit/hypit/generation";

export const providerModule = { name: "@workbench/provider-openai-image", version: "1" } as const;
export const capability = { module: { name: "@hypit/gpt-image", version: "1" }, name: "gpt-image-2" } as const;

export type CreateOpenAiImageProviderOptions = {
  instance: string; pool: string; baseUrl: string; apiKey: CredentialRef;
  wireModel: string; concurrency?: number; requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export function createOpenAiImageProvider(options: CreateOpenAiImageProviderOptions) {
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
      supports: (_request: EndpointRequest) => ({ status: "supported" as const }),
      handler: async () => { throw new Error("OpenAI Image Provider 尚未实现（Task 2）"); },
    }],
  });
}
