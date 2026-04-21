import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import type { SwarmConfig, SwarmEvent, InterventionPoint, InterventionStrategy, LLMBackendConfig, SwarmAgentConfig } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { createAgent } from "./agent-factory.js";
import { messageToStored } from "../storage/message-mapper.js";
import { RouterMode } from "../modes/router.js";
import { SequentialMode } from "../modes/sequential.js";
import { ParallelMode } from "../modes/parallel.js";
import { SwarmMode } from "../modes/swarm-mode.js";
import { DebateMode } from "../modes/debate.js";
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
  private eventListeners: ((event: SwarmEvent) => void)[] = [];
  private _aborted = false;

  constructor(
    id: string,
    swarmConfig: SwarmConfig,
    storage: IStorage,
    llmConfig: LLMBackendConfig,
    interventionHandler?: InterventionHandler,
  ) {
    this.id = id;
    this.swarmConfig = swarmConfig;
    this.storage = storage;
    this.llmConfig = llmConfig;
    this.interventionHandler = interventionHandler;
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

    yield { type: "swarm_start", swarmId: this.swarmConfig.id, conversationId: this.id };

    try {
      // Get the appropriate mode executor
      const executor = this.getModeExecutor();
      const context = this.createModeContext(message);

      yield* executor.execute(context);
    } catch (err) {
      yield { type: "error", error: err as Error } as SwarmEvent;
    }

    yield { type: "swarm_end", swarmId: this.swarmConfig.id, conversationId: this.id, finalMessage: "" } as SwarmEvent;
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
        const agent = createAgent({
          config,
          llmConfig: this.llmConfig,
          interventionHandler: this.interventionHandler,
        });
        this.agents.set(config.id, { agent, config });
      },
      emit: (event: SwarmEvent) => this.emit(event),
      isAborted: () => this._aborted,
    };
  }
}
