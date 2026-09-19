import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createApimartProvider, providerModule } from "./provider.js";

const MODEL_MAP_KEYS = ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2.5", "gpt-image-2"] as const;

const DEFAULT_MODEL_MAP: Readonly<Record<string, string>> = {
  "seedance-2": "seedance-2.0",
  "seedance-2-fast": "",
  "seedance-2-mini": "",
  "seedance-2.5": "",
  "gpt-image-2": "gpt-image-2",
};

// APIMart 部分模型 ID 因账号开通情况而异，没有可用的非空默认值——空字符串直接保留，不在这里
// 报错。activatedEndpoints 用一个 Promise.all 加载全部 endpoint，没有逐项 try/catch，activation
// 抛错会拖垮整个 Profile 的其它 endpoint；因此空模型 ID 的判断推迟到各 capability 的 start()，
// 返回 failed（APIMART_MODEL_ID_MISSING）。
function resolveModelId(rawValue: unknown, key: string): string {
  if (typeof rawValue === "string") return rawValue;
  return DEFAULT_MODEL_MAP[key] ?? "";
}

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "APIMart service");
      runtimeConfigExact(
        config,
        ["baseUrl", "apiKey", "modelMap", "defaultConcurrency", "pollIntervalMs", "requestTimeoutMs", "maxOperationMs"],
        "APIMart service",
      );
      const baseUrl = runtimeConfigString(config.baseUrl, "baseUrl") ?? "https://api.apimart.ai";
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "apiKey");
      const modelMapConfig = config.modelMap === undefined ? undefined : runtimeConfigObject(config.modelMap, "modelMap");
      const modelMap: Record<string, string> = {};
      for (const key of MODEL_MAP_KEYS) {
        modelMap[key] = resolveModelId(modelMapConfig?.[key], key);
      }
      if (!apiKey || !context.pool) throw new Error(`${context.instance} 需要 apiKey 凭据引用`);
      return {
        endpoint: createApimartProvider({
          instance: context.instance, pool: context.pool, baseUrl, apiKey, modelMap,
          concurrency: runtimeConfigPositiveInteger(config.defaultConcurrency, "defaultConcurrency") ?? 2,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 8_000,
          requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 120_000,
          maxOperationMs: runtimeConfigPositiveInteger(config.maxOperationMs, "maxOperationMs") ?? 20 * 60_000,
        }),
      };
    },
  })],
};
