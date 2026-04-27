import { describe, it, expect } from "vitest";
import type { LLMBackendConfig } from "../core/types.js";
import { resolveModelFromProvider } from "./provider.js";

function createConfig(config?: Partial<LLMBackendConfig>): LLMBackendConfig {
  return {
    apiKeys: {},
    providers: {},
    ...config,
  };
}

describe("resolveModelFromProvider", () => {
  it("uses provider thinkingFormat when model does not override it", () => {
    const model = resolveModelFromProvider(
      "provider-a",
      "model-a",
      createConfig({
        providers: {
          "provider-a": {
            baseUrl: "https://example.com/v1",
            apiProtocol: "openai-completions",
            thinkingFormat: "openrouter",
          },
        },
      }),
    );

    expect(model.compat).toMatchObject({
      thinkingFormat: "openrouter",
    });
  });

  it("keeps model-level compat.thinkingFormat over provider default", () => {
    const model = resolveModelFromProvider(
      "provider-a",
      "model-a",
      createConfig({
        providers: {
          "provider-a": {
            baseUrl: "https://example.com/v1",
            apiProtocol: "openai-completions",
            thinkingFormat: "openrouter",
          },
        },
      }),
      {
        provider: "provider-a",
        modelId: "model-a",
        options: {
          compat: {
            thinkingFormat: "deepseek",
            supportsReasoningEffort: false,
          },
        },
      },
    );

    expect(model.compat).toMatchObject({
      thinkingFormat: "deepseek",
      supportsReasoningEffort: false,
    });
  });
});
