import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { BeforeToolCallResult, AfterToolCallResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { SwarmConfig, SwarmEvent, InterventionPoint, LLMBackendConfig, SwarmAgentConfig } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { StoredMessage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { createAgent } from "./agent-factory.js";
import { RouterMode } from "../modes/router.js";
import { SequentialMode } from "../modes/sequential.js";
import { ParallelMode } from "../modes/parallel.js";
import { SwarmMode } from "../modes/swarm-mode.js";
import { DebateMode } from "../modes/debate.js";
import { createRouteToAgentTool } from "../tools/route-to-agent.js";
import { createHandoffTool } from "../tools/handoff.js";
import { respondToUserTool } from "../tools/respond-to-user.js";
import { storedToMessage } from "../storage/message-mapper.js";
import type { ModeExecutor, ModeExecutionContext } from "../modes/types.js";

export type InterventionCallback = (
  point: InterventionPoint,
  context: any,
) => Promise<any>;

interface ActiveAgent {
  agent: Agent;
  config: SwarmAgentConfig;
}

export class Conversation {
  private id: string;
  private swarmConfig: SwarmConfig;
  private storage: IStorage;
  private interventionHandler?: InterventionHandler;
  private interventionCallback?: InterventionCallback;
  private llmConfig: LLMBackendConfig;
  private agents: Map<string, ActiveAgent> = new Map();
  private restoredMessages: Message[];
  private eventListeners: ((event: SwarmEvent) => void)[] = [];
  private _aborted = false;

  constructor(
    id: string,
    swarmConfig: SwarmConfig,
    storage: IStorage,
    llmConfig: LLMBackendConfig,
    interventionHandler?: InterventionHandler,
    restoredHistory: StoredMessage[] = [],
  ) {
    this.id = id;
    this.swarmConfig = swarmConfig;
    this.storage = storage;
    this.llmConfig = llmConfig;
    this.interventionHandler = interventionHandler;
    this.restoredMessages = restoredHistory.map((msg) => storedToMessage(msg));
  }

  getId(): string { return this.id; }

  /**
   * Send a user message and stream SwarmEvents as the collaboration unfolds.
   */
  async *prompt(message: string): AsyncGenerator<SwarmEvent> {
    this._aborted = false;

    // Save user message
    await this.storage.appendMessage(this.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    const startEvent: SwarmEvent = { type: "swarm_start", swarmId: this.swarmConfig.id, conversationId: this.id };
    this.emit(startEvent);
    yield startEvent;

    try {
      const executor = this.getModeExecutor();
      const context = this.createModeContext(message);
      yield* executor.execute(context);
    } catch (err) {
      const errorEvent: SwarmEvent = { type: "error", error: err as Error } as SwarmEvent;
      this.emit(errorEvent);
      yield errorEvent;
    }

    const endEvent: SwarmEvent = {
      type: "swarm_end",
      swarmId: this.swarmConfig.id,
      conversationId: this.id,
      finalMessage: "",
    } as SwarmEvent;
    this.emit(endEvent);
    yield endEvent;
  }

  /**
   * Register an event listener for SwarmEvents.
   */
  onEvent(fn: (event: SwarmEvent) => void): () => void {
    this.eventListeners.push(fn);
    return () => {
      this.eventListeners = this.eventListeners.filter((f) => f !== fn);
    };
  }

  /**
   * Register intervention callback.
   */
  onIntervention(callback: InterventionCallback): void {
    this.interventionCallback = callback;
  }

  /**
   * Abort the current run.
   */
  abort(): void {
    this._aborted = true;
    for (const [, active] of this.agents) {
      active.agent.abort();
    }
  }

  /**
   * Get conversation history from storage.
   */
  async getHistory() {
    return this.storage.getMessages(this.id);
  }

  // ── Private ──

  private emit(event: SwarmEvent) {
    void this.storage.logEvent(this.id, {
      id: crypto.randomUUID(),
      agentId: null,
      eventType: event.type,
      eventData: JSON.stringify(this.serializeEvent(event)),
      timestamp: Date.now(),
    }).catch(() => { /* ignore log write failures */ });

    if (event.type === "error") {
      const strategy = this.getInterventionStrategy("on_error");
      if (strategy !== "auto") {
        void this.requestIntervention("on_error", {
          agentId: event.agentId,
          error: event.error,
        }).catch(() => { /* ignore callback failures */ });
      }
    }

    if (event.type === "agent_end") {
      const strategy = this.getInterventionStrategy("after_agent_end");
      if (strategy !== "auto") {
        void this.requestIntervention("after_agent_end", {
          agentId: event.agentId,
        }).catch(() => { /* ignore callback failures */ });
      }
    }

    for (const fn of this.eventListeners) {
      fn(event);
    }
  }

  private getModeExecutor(): ModeExecutor {
    switch (this.swarmConfig.mode) {
      case "router": return new RouterMode();
      case "sequential": return new SequentialMode();
      case "parallel": return new ParallelMode();
      case "swarm": return new SwarmMode();
      case "debate": return new DebateMode();
      default: throw new Error(`Unknown mode: ${this.swarmConfig.mode}`);
    }
  }

  private createModeContext(message: string): ModeExecutionContext {
    return {
      swarmConfig: this.swarmConfig,
      message,
      conversationId: this.id,
      storage: this.storage,
      interventionHandler: this.interventionHandler,
      interventionCallback: this.interventionCallback,
      llmConfig: this.llmConfig,
      agents: this.agents,
      createAgentFn: (config: SwarmAgentConfig) => {
        const enhancedConfig = this.withAutoTools(config);
        const agent = createAgent({
          config: enhancedConfig,
          llmConfig: this.llmConfig,
          interventionHandler: this.interventionHandler,
          beforeToolCall: async (toolContext): Promise<BeforeToolCallResult | undefined> => {
            let point: InterventionPoint = "before_tool_call";
            let strategy = this.getInterventionStrategy(point, enhancedConfig);
            if (strategy === "auto") {
              point = "on_approval_required";
              strategy = this.getInterventionStrategy(point, enhancedConfig);
            }
            if (strategy === "auto") return undefined;

            const decision = await this.requestIntervention(point, {
              agentId: enhancedConfig.id,
              toolName: toolContext.toolCall.name,
              arguments: toolContext.args,
            });
            if (decision?.action === "abort") {
              this.abort();
              return { block: true, reason: decision.reason ?? "Tool call aborted by intervention" };
            }
            if (decision?.action === "reject") {
              return { block: true, reason: decision.reason ?? "Tool call rejected by intervention" };
            }
            return undefined;
          },
          afterToolCall: async (toolContext): Promise<AfterToolCallResult | undefined> => {
            const strategy = this.getInterventionStrategy("after_tool_call", enhancedConfig);
            if (strategy === "auto") return undefined;
            const decision = await this.requestIntervention("after_tool_call", {
              agentId: enhancedConfig.id,
              toolName: toolContext.toolCall.name,
              arguments: toolContext.args,
              result: toolContext.result,
            });
            if (decision?.action === "abort") {
              this.abort();
              return {
                isError: true,
                content: [{ type: "text", text: decision.reason ?? "Tool result aborted by intervention" }],
              };
            }
            if (decision?.action === "reject") {
              return {
                isError: true,
                content: [{ type: "text", text: decision.reason ?? "Tool result rejected by intervention" }],
              };
            }
            return undefined;
          },
        });
        if (this.restoredMessages.length > 0 && agent.state.messages.length === 0) {
          agent.state.messages = [...this.restoredMessages];
        }
        this.agents.set(config.id, { agent, config: enhancedConfig });
      },
      emit: (event: SwarmEvent) => this.emit(event),
      abort: () => this.abort(),
      isAborted: () => this._aborted,
    };
  }

  private withAutoTools(config: SwarmAgentConfig): SwarmAgentConfig {
    const mergedTools: AgentTool<any>[] = [...(config.tools ?? [])];

    for (const tool of this.getAutoTools(config)) {
      if (!mergedTools.some((existing) => existing.name === tool.name)) {
        mergedTools.push(tool);
      }
    }

    return {
      ...config,
      tools: mergedTools,
    };
  }

  private getAutoTools(config: SwarmAgentConfig): AgentTool<any>[] {
    const tools: AgentTool<any>[] = [respondToUserTool];

    const availableAgents = this.swarmConfig.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
    }));
    if (
      this.swarmConfig.orchestrator
      && !availableAgents.some((agent) => agent.id === this.swarmConfig.orchestrator!.id)
    ) {
      availableAgents.push({
        id: this.swarmConfig.orchestrator.id,
        name: this.swarmConfig.orchestrator.name,
        description: this.swarmConfig.orchestrator.description,
      });
    }

    if (
      this.swarmConfig.mode === "router"
      && this.swarmConfig.orchestrator
      && config.id === this.swarmConfig.orchestrator.id
    ) {
      tools.push(createRouteToAgentTool(availableAgents));
    }

    if (this.swarmConfig.mode === "swarm") {
      tools.push(
        createHandoffTool(availableAgents.filter((agent) => agent.id !== config.id)),
      );
    }

    return tools;
  }

  private getInterventionStrategy(point: InterventionPoint, config?: SwarmAgentConfig): string {
    return config?.interventions?.[point]
      ?? this.swarmConfig.interventions?.[point]
      ?? "auto";
  }

  private async requestIntervention(point: InterventionPoint, context: any): Promise<any> {
    if (this.interventionCallback) {
      return this.interventionCallback(point, context);
    }
    if (this.interventionHandler) {
      return this.interventionHandler.onIntervention(point, context);
    }
    return { action: "approve" };
  }

  private serializeEvent(event: SwarmEvent): unknown {
    const serialized = { ...event } as Record<string, unknown>;
    if ("error" in serialized && serialized.error instanceof Error) {
      serialized.error = {
        name: serialized.error.name,
        message: serialized.error.message,
        stack: serialized.error.stack,
      };
    }
    if ("respond" in serialized) {
      delete serialized.respond;
    }
    return serialized;
  }
}
