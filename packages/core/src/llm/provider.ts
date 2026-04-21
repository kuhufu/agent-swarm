import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { ModelConfig, LLMBackendConfig, ThinkingLevel } from "../core/types.js";

const PI_THINKING_LEVEL_MAP: Record<string, import("@mariozechner/pi-agent-core").ThinkingLevel> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
};

/**
 * Resolve a ModelConfig to a pi-ai Model instance.
 */
export function resolveModel(config: ModelConfig): Model<any> {
  // For known providers, use getModel from pi-ai
  const knownProviders = ["anthropic", "openai", "google", "xai", "groq", "cerebras", "openrouter", "zai"];
  if (knownProviders.includes(config.provider)) {
    try {
      return getModel(config.provider as any, config.modelId as any);
    } catch {
      // Model ID not in MODELS registry, fall through to manual construction
    }
  }

  // Manual model construction for custom/unknown providers
  return {
    id: config.modelId,
    name: config.modelId,
    api: "openai-completions" as const,
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
 * Map our ThinkingLevel to pi-agent-core ThinkingLevel.
 */
export function mapThinkingLevel(level?: ThinkingLevel): import("@mariozechner/pi-agent-core").ThinkingLevel {
  if (!level) return "off";
  return PI_THINKING_LEVEL_MAP[level] ?? "off";
}
