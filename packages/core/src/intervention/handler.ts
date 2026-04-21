import type { InterventionPoint, InterventionStrategy, InterventionDecision } from "./types.js";

export interface InterventionContext {
  agentId?: string;
  toolName?: string;
  arguments?: any;
  result?: any;
  error?: Error;
  fromAgentId?: string;
  toAgentId?: string;
  input?: string;
  output?: string;
}

export interface InterventionRequest {
  id: string;
  point: InterventionPoint;
  strategy: InterventionStrategy;
  context: InterventionContext;
  timestamp: number;
}

export abstract class InterventionHandler {
  abstract onIntervention(
    point: InterventionPoint,
    context: InterventionContext,
  ): Promise<InterventionDecision>;
}
