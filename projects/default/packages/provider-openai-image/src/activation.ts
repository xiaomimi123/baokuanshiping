import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createOpenAiImageProvider, providerModule } from "./provider.js";

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "OpenAI image service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "wireModel", "defaultConcurrency", "requestTimeoutMs"], "OpenAI image service");
      const baseUrl = runtimeConfigString(config.baseUrl, "baseUrl") ?? "https://api.openai.com";
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "apiKey");
      const wireModel = runtimeConfigString(config.wireModel, "wireModel") ?? "gpt-image-1";
      if (!apiKey || !context.pool) throw new Error("openai.images 需要 apiKey 凭据引用");
      return { endpoint: createOpenAiImageProvider({
        instance: context.instance, pool: context.pool, baseUrl, apiKey, wireModel,
        concurrency: runtimeConfigPositiveInteger(config.defaultConcurrency, "defaultConcurrency") ?? 2,
        requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 180_000,
      }) };
    },
  })],
};
