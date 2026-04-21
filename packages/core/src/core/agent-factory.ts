import { Agent } from "@mariozechner/pi-agent-core";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { SwarmAgentConfig, ModelConfig, InterventionPoint } from "./types.js";
import { resolveModel, mapThinkingLevel } from "../llm/provider.js";
import type { LLMBackendConfig } from "./types.js";
import type { InterventionHandler } from "../intervention/handler.js";

interface CreateAgentOptions {
  config: SwarmAgentConfig;
  llmConfig: LLMBackendConfig;
  interventionHandler?: InterventionHandler;
}

/**
 * Create a pi-agent-core Agent instance from SwarmAgentConfig.
 */
export function createAgent(opts: CreateAgentOptions): Agent {
  const { config, llmConfig } = opts;

  const apiKeys = { ...llmConfig.apiKeys };
  if (config.model.apiKey) {
    apiKeys[config.model.provider] = config.model.apiKey;
  }

  const model = resolveModel(config.model);
  const thinkingLevel = mapThinkingLevel(config.thinkingLevel);

  // Build tools list — intervention hooks are handled at mode level, not agent level
  const tools = config.tools ?? [];

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model,
      thinkingLevel,
      tools,
      messages: [],
    },
    getApiKey: (provider: string) => apiKeys[provider],
    steeringMode: "one-at-a-time",
  });

  return agent;
}
