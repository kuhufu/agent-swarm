import { getModel } from "@mariozechner/pi-ai";
import type { Model, KnownApi } from "@mariozechner/pi-ai";
import type { ModelConfig, LLMBackendConfig, ThinkingLevel, ApiProtocol } from "../core/types.js";

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

/**
 * Resolve a ModelConfig to a pi-ai Model instance.
 * Uses apiProtocol and baseUrl when provided.
 */
export function resolveModel(config: ModelConfig): Model<any> {
  const apiProtocol = config.apiProtocol ?? DEFAULT_PROTOCOL_MAP[config.provider] ?? "openai-completions";

  // For known providers without custom baseUrl/apiProtocol, try the model registry
  if (!config.baseUrl && !config.apiProtocol) {
    const knownProviders = Object.keys(DEFAULT_PROTOCOL_MAP);
    if (knownProviders.includes(config.provider)) {
      try {
        return getModel(config.provider as any, config.modelId as any);
      } catch {
        // Model ID not in registry, fall through to manual construction
      }
    }
  }

  // Manual model construction with custom baseUrl and/or apiProtocol
  return {
    id: config.modelId,
    name: config.modelId,
    api: apiProtocol as KnownApi,
    provider: config.provider,
    baseUrl: config.baseUrl ?? `https://api.${config.provider}.com/v1`,
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
