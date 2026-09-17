import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createGeminiImageProvider, providerModule } from "./provider.js";

const DEFAULT_MODEL_MAP: Readonly<Record<string, string>> = {
  "nano-banana-2": "gemini-2.5-flash-image",
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

// A blank/missing modelMap.<capability> value must never fail Runtime Profile activation for the
// *other* endpoints sharing it (activatedEndpoints loads all endpoints via one Promise.all with no
// per-item try/catch) — so we fall back to the default model ID here instead of throwing. If the
// resolved model ID is still empty, createGeminiImageProvider()'s handler raises the Chinese error
// at request time, scoping the failure to a single capability instead of the whole profile.
function resolveModelId(rawValue: unknown, fallback: string): string {
  return typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue : fallback;
}

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "Gemini image service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "modelMap", "defaultConcurrency", "requestTimeoutMs"], "Gemini image service");
      const baseUrl = runtimeConfigString(config.baseUrl, "baseUrl") ?? "https://generativelanguage.googleapis.com";
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "apiKey");
      const modelMapConfig = config.modelMap === undefined ? undefined : runtimeConfigObject(config.modelMap, "modelMap");
      const modelMap: Record<string, string> = { ...DEFAULT_MODEL_MAP };
      if (modelMapConfig !== undefined) {
        for (const key of Object.keys(DEFAULT_MODEL_MAP)) {
          modelMap[key] = resolveModelId(modelMapConfig[key], DEFAULT_MODEL_MAP[key]!);
        }
      }
      if (!apiKey || !context.pool) throw new Error("gemini.images 需要 apiKey 凭据引用");
      return { endpoint: createGeminiImageProvider({
        instance: context.instance, pool: context.pool, baseUrl, apiKey, modelMap,
        concurrency: runtimeConfigPositiveInteger(config.defaultConcurrency, "defaultConcurrency") ?? 2,
        requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 180_000,
      }) };
    },
  })],
};
