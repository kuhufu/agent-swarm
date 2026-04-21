export interface ModeExecutor {
  execute(context: ModeExecutionContext): AsyncGenerator<import("../core/types.js").SwarmEvent>;
}

export interface ModeExecutionContext {
  swarmConfig: import("../core/types.js").SwarmConfig;
  message: string;
  conversationId: string;
  storage: import("../storage/interface.js").IStorage;
  interventionHandler?: import("../intervention/handler.js").InterventionHandler;
  abortSignal?: AbortSignal;
}
