import type { Model, KnownApi, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { ModelConfig, LLMBackendConfig, ThinkingLevel } from "../core/types.js";

const PI_THINKING_LEVEL_MAP: Record<string, import("@mariozechner/pi-agent-core").ThinkingLevel> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

/** Default API protocol per known provider */
const DEFAULT_PROTOCOL_MAP: Record<string, KnownApi> = {
  anthropic: "anthropic-messages",
  openai: "openai-completions",
  google: "google-generative-ai",
  xai: "openai-completions",
  groq: "openai-completions",
  cerebras: "openai-completions",
  openrouter: "openai-completions",
  mistral: "mistral-conversations",
  zai: "openai-completions",
};

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl || typeof baseUrl !== "string") {
    return baseUrl;
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function normalizeModelOptions(options: ModelConfig["options"] | undefined): NonNullable<ModelConfig["options"]> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {};
  }
  return options;
}

function normalizeCompatOptions(
  compat: unknown,
): Record<string, unknown> | undefined {
  if (!compat || typeof compat !== "object" || Array.isArray(compat)) {
    return undefined;
  }
  return { ...(compat as Record<string, unknown>) };
}

function resolveModelReasoning(
  options: NonNullable<ModelConfig["options"]>,
  reasoning?: boolean,
): boolean {
  // reasoning param from caller (e.g. resolved thinking level) takes priority
  if (typeof reasoning === "boolean") {
    return reasoning;
  }
  // explicit options.reasoning flag
  if (typeof options.reasoning === "boolean") {
    return options.reasoning;
  }
  // explicit thinkingFormat implies reasoning support
  const compat = options.compat;
  if (compat && typeof compat === "object" && !Array.isArray(compat)) {
    const thinkingFormat = (compat as Record<string, unknown>).thinkingFormat;
    if (typeof thinkingFormat === "string" && thinkingFormat.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function resolveOpenAICompat(
  apiProtocol: KnownApi,
  options: NonNullable<ModelConfig["options"]>,
): Partial<OpenAICompletionsCompat> | undefined {
  if (apiProtocol !== "openai-completions") {
    return undefined;
  }

  const nextCompat: Partial<OpenAICompletionsCompat> = {};
  const rawCompat = options.compat;
  if (rawCompat && typeof rawCompat === "object" && !Array.isArray(rawCompat)) {
    Object.assign(nextCompat, rawCompat);
  }

  return Object.keys(nextCompat).length > 0 ? nextCompat : undefined;
}

/**
 * Resolve a ModelConfig to a pi-ai Model instance.
 * Uses apiProtocol and baseUrl.
 */
export function resolveModel(config: ModelConfig & { reasoning?: boolean }): Model<any> {
  const apiProtocol = config.apiProtocol ?? DEFAULT_PROTOCOL_MAP[config.provider] ?? "openai-completions";
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const normalizedOptions = normalizeModelOptions(config.options);
  const modelReasoning = resolveModelReasoning(normalizedOptions, config.reasoning);
  const modelCompat = resolveOpenAICompat(apiProtocol as KnownApi, normalizedOptions);

  if (!normalizedBaseUrl) {
    throw new Error(`Provider ${config.provider} 缺少 baseUrl，当前仅支持通过 baseUrl 调用模型`);
  }

  // Manual model construction with explicit baseUrl
  return {
    id: config.modelId,
    name: config.modelId,
    api: apiProtocol as KnownApi,
    provider: config.provider,
    baseUrl: normalizedBaseUrl,
    reasoning: modelReasoning,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
    ...(modelCompat ? { compat: modelCompat } : {}),
  };
}

/**
 * Resolve a provider's ModelConfig from LLMBackendConfig + provider-specific overrides.
 */
export function resolveModelFromProvider(
  providerId: string,
  modelId: string,
  llmConfig: LLMBackendConfig,
  perAgentOverride?: ModelConfig,
  reasoning?: boolean,
): Model<any> {
  const providerConfig = llmConfig.providers?.[providerId];
  const apiKey = perAgentOverride?.apiKey ?? llmConfig.apiKeys[providerId] ?? "";
  const overrideOptions = normalizeModelOptions(perAgentOverride?.options);
  const overrideCompat = normalizeCompatOptions(overrideOptions.compat);
  const mergedCompat = (() => {
    if (overrideCompat) {
      // Model-level compat.thinkingFormat should override provider default.
      if (overrideCompat.thinkingFormat !== undefined) {
        return overrideCompat;
      }
      if (providerConfig?.thinkingFormat) {
        return { ...overrideCompat, thinkingFormat: providerConfig.thinkingFormat };
      }
      return overrideCompat;
    }

    if (providerConfig?.thinkingFormat) {
      return { thinkingFormat: providerConfig.thinkingFormat };
    }

    return undefined;
  })();

  const mergedOptions = {
    ...overrideOptions,
    ...(mergedCompat ? { compat: mergedCompat } : {}),
  };
  const options = Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined;

  return resolveModel({
    provider: providerId,
    modelId,
    apiKey,
    baseUrl: perAgentOverride?.baseUrl ?? providerConfig?.baseUrl,
    apiProtocol: perAgentOverride?.apiProtocol ?? providerConfig?.apiProtocol,
    options,
    reasoning,
  });
}

/**
 * Map our ThinkingLevel to pi-agent-core ThinkingLevel.
 */
export function mapThinkingLevel(level?: ThinkingLevel): import("@mariozechner/pi-agent-core").ThinkingLevel {
  if (!level) return "off";
  return PI_THINKING_LEVEL_MAP[level] ?? "off";
}
