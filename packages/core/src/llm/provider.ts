import type { Model, KnownApi } from "@mariozechner/pi-ai";
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

/**
 * Resolve a ModelConfig to a pi-ai Model instance.
 * Uses apiProtocol and baseUrl.
 */
export function resolveModel(config: ModelConfig): Model<any> {
  const apiProtocol = config.apiProtocol ?? DEFAULT_PROTOCOL_MAP[config.provider] ?? "openai-completions";
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);

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
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
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

  return resolveModel({
    provider: providerId,
    modelId,
    apiKey,
    baseUrl: perAgentOverride?.baseUrl ?? providerConfig?.baseUrl,
    apiProtocol: perAgentOverride?.apiProtocol ?? providerConfig?.apiProtocol,
  });
}

/**
 * Map our ThinkingLevel to pi-agent-core ThinkingLevel.
 */
export function mapThinkingLevel(level?: ThinkingLevel): import("@mariozechner/pi-agent-core").ThinkingLevel {
  if (!level) return "off";
  return PI_THINKING_LEVEL_MAP[level] ?? "off";
}
