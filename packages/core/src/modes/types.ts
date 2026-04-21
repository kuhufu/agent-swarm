import type { SwarmConfig, SwarmEvent } from "../core/types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import type { Agent } from "@mariozechner/pi-agent-core";
import type { SwarmAgentConfig, LLMBackendConfig, InterventionPoint } from "../core/types.js";

export interface ModeExecutionContext {
  swarmConfig: SwarmConfig;
  message: string;
  conversationId: string;
  storage: IStorage;
  interventionHandler?: InterventionHandler;
  interventionCallback?: (point: InterventionPoint, context: any) => Promise<any>;
  llmConfig: LLMBackendConfig;
  abortSignal?: AbortSignal;
  /** Callback to create and register an agent */
  createAgentFn: (config: SwarmAgentConfig) => void;
  /** Map of already created agents */
  agents: Map<string, { agent: Agent; config: SwarmAgentConfig }>;
  /** Emit event to listeners */
  emit: (event: SwarmEvent) => void;
  /** Whether the execution has been aborted */
  isAborted: () => boolean;
}

export interface ModeExecutor {
  execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent>;
}
