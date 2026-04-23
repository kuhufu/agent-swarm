import type { Model, KnownApi, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import type { ModelConfig, LLMBackendConfig, ThinkingLevel } from "../core/types.js";

const PI_THINKING_LEVEL_MAP: Record<string, import("@mariozechner/pi-agent-core").ThinkingLevel> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
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

function resolveModelReasoning(options: NonNullable<ModelConfig["options"]>): boolean {
  if (typeof options.reasoning === "boolean") {
    return options.reasoning;
  }
  if (typeof options.enable_thinking === "boolean") {
    return options.enable_thinking;
  }

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

  if (options.enable_thinking === true) {
    if (!nextCompat.thinkingFormat) {
      nextCompat.thinkingFormat = "qwen";
    }
    if (nextCompat.supportsReasoningEffort === undefined) {
      nextCompat.supportsReasoningEffort = false;
    }
    if (nextCompat.supportsDeveloperRole === undefined) {
      nextCompat.supportsDeveloperRole = false;
    }
  }

  return Object.keys(nextCompat).length > 0 ? nextCompat : undefined;
}

/**
 * Resolve a ModelConfig to a pi-ai Model instance.
 * Uses apiProtocol and baseUrl.
 */
export function resolveModel(config: ModelConfig): Model<any> {
  const apiProtocol = config.apiProtocol ?? DEFAULT_PROTOCOL_MAP[config.provider] ?? "openai-completions";
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const normalizedOptions = normalizeModelOptions(config.options);
  const modelReasoning = resolveModelReasoning(normalizedOptions);
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
): Model<any> {
  const providerConfig = llmConfig.providers?.[providerId];
  const apiKey = perAgentOverride?.apiKey ?? llmConfig.apiKeys[providerId] ?? "";
  const mergedOptions = {
    ...(providerConfig?.enable_thinking !== undefined ? { enable_thinking: providerConfig.enable_thinking } : {}),
    ...(normalizeModelOptions(perAgentOverride?.options)),
  };
  const options = Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined;

  return resolveModel({
    provider: providerId,
    modelId,
    apiKey,
    baseUrl: perAgentOverride?.baseUrl ?? providerConfig?.baseUrl,
    apiProtocol: perAgentOverride?.apiProtocol ?? providerConfig?.apiProtocol,
    options,
  });
}

/**
 * Map our ThinkingLevel to pi-agent-core ThinkingLevel.
 */
export function mapThinkingLevel(level?: ThinkingLevel): import("@mariozechner/pi-agent-core").ThinkingLevel {
  if (!level) return "off";
  return PI_THINKING_LEVEL_MAP[level] ?? "off";
}
