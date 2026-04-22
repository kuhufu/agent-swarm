import type { LLMBackendConfig } from "../core/types.js";

export class LLMConfigManager {
  private config: LLMBackendConfig;

  constructor(config: LLMBackendConfig) {
    this.config = config;
  }

  getApiKey(provider: string): string | undefined {
    return this.config.apiKeys[provider];
  }

  getEndpoint(provider: string): { baseUrl: string; headers?: Record<string, string> } | undefined {
    return this.config.endpoints?.[provider];
  }

  updateConfig(config: Partial<LLMBackendConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LLMBackendConfig {
    return { ...this.config };
  }
}
