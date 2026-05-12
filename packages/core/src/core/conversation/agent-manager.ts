import { Agent } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { SwarmAgentConfig, SwarmConfig, LLMBackendConfig, ThinkingLevel } from "../types.js";
import { createAgent } from "../agent-factory.js";
import type { ToolRuntimeOptions } from "../../tools/runtime.js";
import { withRuntimeTools } from "../../tools/runtime.js";
import { mapThinkingLevel, resolveModelFromProvider } from "../../llm/provider.js";
import type { InterventionOrchestrator } from "./intervention.js";

interface ActiveAgent {
  agent: Agent;
  config: SwarmAgentConfig;
}

export class AgentManager {
  private agents: Map<string, ActiveAgent> = new Map();
  private swarmConfig: SwarmConfig;
  private llmConfig: LLMBackendConfig;
  private runtimeOptions: ToolRuntimeOptions & { thinkingEnabled?: boolean; thinkingLevel?: ThinkingLevel };
  readonly restoredMessages: Message[];

  constructor(
    swarmConfig: SwarmConfig,
    llmConfig: LLMBackendConfig,
    runtimeOptions: ToolRuntimeOptions & { thinkingEnabled?: boolean; thinkingLevel?: ThinkingLevel },
    restoredMessages: Message[] = [],
  ) {
    this.swarmConfig = swarmConfig;
    this.llmConfig = llmConfig;
    this.runtimeOptions = runtimeOptions;
    this.restoredMessages = restoredMessages;
  }

  updateRuntimeOptions(
    options: ToolRuntimeOptions & { thinkingEnabled?: boolean; thinkingLevel?: ThinkingLevel },
  ): void {
    this.runtimeOptions = options;
  }

  get(id: string): ActiveAgent | undefined {
    return this.agents.get(id);
  }

  getAll(): Map<string, ActiveAgent> {
    return this.agents;
  }

  getOrCreate(
    config: SwarmAgentConfig,
    interventionOrch: InterventionOrchestrator,
    abortFn: () => void,
  ): void {
    const enhancedConfig = this.withAutoTools(config);
    const agent = createAgent({
      config: enhancedConfig,
      llmConfig: this.llmConfig,
      interventionHandler: interventionOrch.handler,
      beforeToolCall: interventionOrch.createBeforeToolCallHook(enhancedConfig, abortFn),
      afterToolCall: interventionOrch.createAfterToolCallHook(enhancedConfig, abortFn),
    });
    if (this.restoredMessages.length > 0 && agent.state.messages.length === 0) {
      agent.state.messages = [...this.restoredMessages];
    }
    this.agents.set(config.id, { agent, config: enhancedConfig });
  }

  syncActiveAgentTools(): void {
    for (const [agentId, active] of this.agents.entries()) {
      const baseConfig = this.resolveAgentConfig(agentId) ?? active.config;
      const enhanced = this.withAutoTools(baseConfig);
      active.config = enhanced;
      active.agent.state.tools = enhanced.tools ?? [];
      active.agent.state.thinkingLevel = mapThinkingLevel(enhanced.thinkingLevel);
    }
  }

  abortAll(): void {
    for (const [, active] of this.agents) {
      active.agent.abort();
    }
  }

  private withAutoTools(config: SwarmAgentConfig): SwarmAgentConfig {
    const enhancedConfig = withRuntimeTools(config, this.swarmConfig, this.runtimeOptions);
    return {
      ...enhancedConfig,
      thinkingLevel: this.resolveRuntimeThinkingLevel(config),
    };
  }

  private resolveAgentConfig(agentId: string): SwarmAgentConfig | undefined {
    if (this.swarmConfig.orchestrator?.id === agentId) {
      return this.swarmConfig.orchestrator;
    }
    return this.swarmConfig.agents.find((agent) => agent.id === agentId);
  }

  private resolveRuntimeThinkingLevel(config: SwarmAgentConfig): SwarmAgentConfig["thinkingLevel"] {
    if (this.runtimeOptions.thinkingEnabled === false) return "off";
    if (this.runtimeOptions.thinkingLevel) return this.runtimeOptions.thinkingLevel;
    if (this.runtimeOptions.thinkingEnabled === undefined) return config.thinkingLevel;
    if (config.thinkingLevel && config.thinkingLevel !== "off") return config.thinkingLevel;
    if (!this.modelSupportsThinking(config)) return "off";
    if (this.llmConfig.defaultThinkingLevel && this.llmConfig.defaultThinkingLevel !== "off") {
      return this.llmConfig.defaultThinkingLevel;
    }
    return "minimal";
  }

  private modelSupportsThinking(config: SwarmAgentConfig): boolean {
    try {
      const model = resolveModelFromProvider(
        config.model.provider,
        config.model.modelId,
        this.llmConfig,
        config.model,
      );
      return model.reasoning === true;
    } catch {
      return false;
    }
  }
}
