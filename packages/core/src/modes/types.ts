import type { SwarmConfig, SwarmEvent } from "../core/types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import type { Agent } from "@mariozechner/pi-agent-core";
import type { SwarmAgentConfig, LLMBackendConfig, InterventionPoint } from "../core/types.js";

import type { ImageContent } from "@mariozechner/pi-ai";

export interface ModeExecutionContext {
  swarmConfig: SwarmConfig;
  message: string;
  images?: ImageContent[];
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
  /** Abort current execution */
  abort: () => void;
  /** Whether the execution has been aborted */
  isAborted: () => boolean;
  getMetadata: (key: string) => unknown;
  setMetadata: (key: string, value: unknown) => Promise<void>;
}

export interface ModeExecutor {
  execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent>;
}
