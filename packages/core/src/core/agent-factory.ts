import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { SwarmAgentConfig } from "./types.js";
import { resolveModelFromProvider, mapThinkingLevel } from "../llm/provider.js";
import type { LLMBackendConfig } from "./types.js";
import type { InterventionHandler } from "../intervention/handler.js";

interface CreateAgentOptions {
  config: SwarmAgentConfig;
  llmConfig: LLMBackendConfig;
  interventionHandler?: InterventionHandler;
  beforeToolCall?: AgentOptions["beforeToolCall"];
  afterToolCall?: AgentOptions["afterToolCall"];
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

  const thinkingLevel = mapThinkingLevel(config.thinkingLevel);
  const model = resolveModelFromProvider(
    config.model.provider,
    config.model.modelId,
    llmConfig,
    config.model,
  );

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
    beforeToolCall: opts.beforeToolCall,
    afterToolCall: opts.afterToolCall,
  });

  return agent;
}
