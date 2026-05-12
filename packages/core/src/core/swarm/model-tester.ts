import { complete } from "@mariozechner/pi-ai";
import type { LLMBackendConfig, ApiProtocol } from "../types.js";
import { resolveModelFromProvider } from "../../llm/provider.js";
import type { Logger } from "../../logger/types.js";

export interface ModelConnectionTestOptions {
  provider: string;
  modelId: string;
  prompt?: string;
  timeoutMs?: number;
  override?: {
    apiKey?: string;
    baseUrl?: string;
    apiProtocol?: ApiProtocol;
    thinkingFormat?: string;
  };
}

export interface ModelConnectionTestResult {
  ok: boolean;
  provider: string;
  modelId: string;
  text: string;
  stopReason?: string;
  error?: string;
  durationMs: number;
}

export class ModelTester {
  private getLLMConfig: () => LLMBackendConfig;
  private logger: Logger;

  constructor(getLLMConfig: () => LLMBackendConfig, logger: Logger) {
    this.getLLMConfig = getLLMConfig;
    this.logger = logger;
  }

  async testConnection(options: ModelConnectionTestOptions): Promise<ModelConnectionTestResult> {
    const provider = options.provider?.trim();
    const modelId = options.modelId?.trim();
    if (!provider || !modelId) {
      throw new Error("provider and modelId are required");
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.min(options.timeoutMs!, 120_000)
      : 20_000;
    const prompt = typeof options.prompt === "string" && options.prompt.trim().length > 0
      ? options.prompt.trim()
      : "请只回复：OK";

    const llmConfig = this.cloneLLMConfig(this.getLLMConfig());
    if (options.override?.apiKey !== undefined) {
      llmConfig.apiKeys = {
        ...(llmConfig.apiKeys ?? {}),
        [provider]: options.override.apiKey,
      };
    }
    if (
      options.override?.baseUrl !== undefined
      || options.override?.apiProtocol !== undefined
      || options.override?.thinkingFormat !== undefined
    ) {
      llmConfig.providers = {
        ...(llmConfig.providers ?? {}),
        [provider]: {
          ...(llmConfig.providers?.[provider] ?? {}),
          ...(options.override.baseUrl !== undefined ? { baseUrl: options.override.baseUrl } : {}),
          ...(options.override.apiProtocol !== undefined ? { apiProtocol: options.override.apiProtocol } : {}),
          ...(options.override.thinkingFormat !== undefined ? { thinkingFormat: options.override.thinkingFormat } : {}),
        },
      };
    }

    const model = resolveModelFromProvider(
      provider,
      modelId,
      llmConfig,
      {
        provider,
        modelId,
        apiKey: llmConfig.apiKeys?.[provider] ?? "",
        baseUrl: options.override?.baseUrl,
        apiProtocol: options.override?.apiProtocol,
      },
    );

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const message = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: llmConfig.apiKeys?.[provider] ?? "",
          signal: controller.signal,
          maxTokens: 128,
          temperature: 0,
        },
      );

      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        const rawError = message.errorMessage ?? "Model returned an error stop reason";
        return {
          ok: false,
          provider,
          modelId,
          text,
          stopReason: message.stopReason,
          error: message.stopReason === "aborted"
            ? `请求超时（>${timeoutMs}ms）`
            : rawError,
          durationMs: Date.now() - start,
        };
      }

      return {
        ok: text.length > 0,
        provider,
        modelId,
        text,
        stopReason: message.stopReason,
        durationMs: Date.now() - start,
        ...(text.length === 0 ? { error: "模型返回为空" } : {}),
      };
    } catch (err: any) {
      const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
      return {
        ok: false,
        provider,
        modelId,
        text: "",
        error: raw.includes("aborted")
          ? `请求超时（>${timeoutMs}ms）`
          : raw,
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private cloneLLMConfig(config: LLMBackendConfig): LLMBackendConfig {
    return JSON.parse(JSON.stringify(config)) as LLMBackendConfig;
  }
}
