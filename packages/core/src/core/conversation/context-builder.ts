import type { ImageContent } from "@mariozechner/pi-ai";
import type { SwarmConfig, SwarmEvent, LLMBackendConfig, SwarmAgentConfig } from "../types.js";
import type { IStorage } from "../../storage/interface.js";
import type { ModeExecutionContext } from "../../modes/types.js";
import type { AgentManager } from "./agent-manager.js";
import type { ConversationEventBus } from "./event-bus.js";
import type { InterventionOrchestrator } from "./intervention.js";

export interface BuildModeContextParams {
  swarmConfig: SwarmConfig;
  message: string;
  images?: ImageContent[];
  conversationId: string;
  storage: IStorage;
  llmConfig: LLMBackendConfig;
  agentManager: AgentManager;
  eventBus: ConversationEventBus;
  interventionOrch: InterventionOrchestrator;
  abortFn: () => void;
  isAbortedFn: () => boolean;
  getMetadata: (key: string) => unknown;
  setMetadata: (key: string, value: unknown) => Promise<void>;
}

export function buildModeContext(params: BuildModeContextParams): ModeExecutionContext {
  return {
    swarmConfig: params.swarmConfig,
    message: params.message,
    images: params.images,
    conversationId: params.conversationId,
    storage: params.storage,
    interventionHandler: params.interventionOrch.handler,
    interventionCallback: params.interventionOrch.callback,
    llmConfig: params.llmConfig,
    agents: params.agentManager.getAll(),
    createAgentFn: (config: SwarmAgentConfig) => {
      params.agentManager.getOrCreate(config, params.interventionOrch, params.abortFn);
    },
    emit: (event: SwarmEvent) => {
      params.eventBus.emit(event);
    },
    abort: params.abortFn,
    isAborted: params.isAbortedFn,
    getMetadata: params.getMetadata,
    setMetadata: params.setMetadata,
  };
}
