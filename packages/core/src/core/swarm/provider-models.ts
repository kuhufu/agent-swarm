import { getProviders as piGetProviders, getModels as piGetModels } from "@mariozechner/pi-ai";
import type { Model as PiModel, KnownProvider } from "@mariozechner/pi-ai";
import type { LLMBackendConfig } from "../types.js";
import type { Logger } from "../../logger/types.js";

export interface ProviderInfo {
  id: string;
  builtIn: boolean;
  defaultApiProtocol?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export class ProviderModelManager {
  private getLLMConfig: () => LLMBackendConfig;
  private logger: Logger;

  constructor(getLLMConfig: () => LLMBackendConfig, logger: Logger) {
    this.getLLMConfig = getLLMConfig;
    this.logger = logger;
  }

  listProviders(): ProviderInfo[] {
    const llmConfig = this.getLLMConfig();
    const builtInProviders = piGetProviders() as KnownProvider[];
    const builtInSet = new Set<string>(builtInProviders);

    const result: ProviderInfo[] = builtInProviders.map((id) => ({
      id,
      builtIn: true,
      defaultApiProtocol: this.getDefaultApiProtocol(id),
    }));

    const configuredProviders = new Set<string>([
      ...Object.keys(llmConfig.apiKeys ?? {}),
      ...Object.keys(llmConfig.providers ?? {}),
    ]);

    for (const id of configuredProviders) {
      if (!builtInSet.has(id)) {
        result.push({
          id,
          builtIn: false,
          defaultApiProtocol: this.getDefaultApiProtocol(id),
        });
      }
    }

    return result;
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    const onlineModels = await this.fetchOnlineModels(providerId);
    if (onlineModels.length > 0) {
      return onlineModels;
    }

    const builtInProviders = piGetProviders() as KnownProvider[];
    if ((builtInProviders as string[]).includes(providerId)) {
      try {
        const piModels = piGetModels(providerId as KnownProvider) as PiModel<any>[];
        return piModels.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          api: m.api,
          reasoning: m.reasoning,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
        }));
      } catch {
        // Fall through to saved models
      }
    }

    const savedModels = this.getLLMConfig().models ?? [];
    return savedModels
      .filter((m) => m.provider === providerId)
      .map((m) => ({
        id: m.modelId,
        name: m.name,
        provider: m.provider,
        api: this.getDefaultApiProtocol(providerId) ?? "openai-completions",
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 4096,
      }));
  }

  private async fetchOnlineModels(providerId: string): Promise<ModelInfo[]> {
    const llmConfig = this.getLLMConfig();
    const apiKey = llmConfig.apiKeys?.[providerId];
    const providerConfig = llmConfig.providers?.[providerId];
    const baseUrl = providerConfig?.baseUrl;

    const KNOWN_BASE_URLS: Record<string, string> = {
      openai: "https://api.openai.com",
      anthropic: "https://api.anthropic.com",
      groq: "https://api.groq.com",
      cerebras: "https://api.cerebras.ai",
      openrouter: "https://openrouter.ai/api",
      xai: "https://api.x.ai",
      mistral: "https://api.mistral.ai",
      deepseek: "https://api.deepseek.com",
      siliconflow: "https://api.siliconflow.cn",
      zai: "https://api.z.ai",
    };

    const effectiveBaseUrl = baseUrl ?? KNOWN_BASE_URLS[providerId];
    if (!effectiveBaseUrl || !apiKey) return [];

    try {
      const base = effectiveBaseUrl.replace(/\/+$/, "");
      const modelsUrl = base.endsWith("/v1")
        ? `${base}/models`
        : `${base}/v1/models`;
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      if (providerId === "anthropic") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        delete headers["Authorization"];
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const body = await response.json() as any;
      const rawModels: any[] = body?.data ?? body?.models ?? [];
      if (!Array.isArray(rawModels)) return [];

      const apiProtocol = this.getDefaultApiProtocol(providerId) ?? "openai-completions";

      return rawModels
        .filter((m: any) => typeof m.id === "string")
        .map((m: any) => ({
          id: m.id,
          name: m.name ?? m.id,
          provider: providerId,
          api: apiProtocol,
          reasoning: false,
          contextWindow: m.context_window ?? m.contextWindow ?? 128000,
          maxTokens: m.max_output_tokens ?? m.maxTokens ?? 4096,
        }))
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  private getDefaultApiProtocol(providerId: string): string | undefined {
    const llmConfig = this.getLLMConfig();
    const providerConfig = llmConfig.providers?.[providerId];
    if (providerConfig?.apiProtocol) return providerConfig.apiProtocol;

    const PROTOCOL_MAP: Record<string, string> = {
      anthropic: "anthropic-messages",
      openai: "openai-completions",
      google: "google-generative-ai",
      xai: "openai-completions",
      groq: "openai-completions",
      cerebras: "openai-completions",
      openrouter: "openai-completions",
      mistral: "mistral-conversations",
      deepseek: "openai-completions",
      siliconflow: "openai-completions",
      zai: "openai-completions",
    };
    return PROTOCOL_MAP[providerId];
  }
}
