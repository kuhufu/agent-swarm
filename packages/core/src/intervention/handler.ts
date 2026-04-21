import type { InterventionPoint, InterventionStrategy, InterventionDecision, InterventionContext } from "./types.js";

/**
 * Intervention request that includes a Promise resolver.
 * When an intervention is triggered, the execution pauses until
 * the promise is resolved (by user action via WebSocket, etc.).
 */
export interface PendingIntervention {
  id: string;
  point: InterventionPoint;
  strategy: InterventionStrategy;
  context: InterventionContext;
  timestamp: number;
  resolve: (decision: InterventionDecision) => void;
}

/**
 * Abstract base class for intervention handling.
 * Override `onIntervention` to implement custom intervention logic.
 */
export abstract class InterventionHandler {
  abstract onIntervention(
    point: InterventionPoint,
    context: InterventionContext,
  ): Promise<InterventionDecision>;
}

/**
 * WS-based intervention handler that bridges to the frontend.
 * When an intervention is required, it creates a promise that waits
 * for the frontend to respond via WebSocket.
 */
export class WSInterventionHandler extends InterventionHandler {
  private pending: Map<string, PendingIntervention> = new Map();

  /**
   * Called when an intervention is required.
   * Returns a promise that resolves when the frontend sends back a decision.
   */
  onIntervention(point: InterventionPoint, context: InterventionContext): Promise<InterventionDecision> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const pending: PendingIntervention = {
        id,
        point,
        strategy: "confirm",
        context,
        timestamp: Date.now(),
        resolve,
      };
      this.pending.set(id, pending);
    });
  }

  /**
   * Get all pending interventions (for broadcasting to frontend).
   */
  getPendingInterventions(): PendingIntervention[] {
    return Array.from(this.pending.values());
  }

  /**
   * Resolve a pending intervention (called when frontend sends back a decision).
   */
  resolveIntervention(id: string, decision: InterventionDecision): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    pending.resolve(decision);
    this.pending.delete(id);
    return true;
  }

  /**
   * Check if there are any pending interventions.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }
}
