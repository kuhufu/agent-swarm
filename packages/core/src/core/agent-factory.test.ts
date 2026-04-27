import { describe, it, expect } from "vitest";
import { createAgent } from "./agent-factory.js";
import type { LLMBackendConfig, SwarmAgentConfig } from "./types.js";

describe("createAgent", () => {
  it("does not force model.reasoning to false when thinkingLevel is off", () => {
    const config: SwarmAgentConfig = {
      id: "agent-1",
      name: "Agent 1",
      description: "Test agent",
      systemPrompt: "You are a test agent.",
      model: {
        provider: "custom-provider",
        modelId: "custom-model",
      },
      thinkingLevel: "off",
    };

    const llmConfig: LLMBackendConfig = {
      apiKeys: {
        "custom-provider": "",
      },
      providers: {
        "custom-provider": {
          baseUrl: "https://example.com/v1",
          apiProtocol: "openai-completions",
          thinkingFormat: "qwen",
        },
      },
    };

    const agent = createAgent({ config, llmConfig });

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.model.reasoning).toBe(true);
  });
});
