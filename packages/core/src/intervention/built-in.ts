import type { InterventionDecision, InterventionContext, InterventionPoint } from "./types.js";
import { InterventionHandler } from "./handler.js";

/**
 * Auto strategy: automatically approve all interventions without user input.
 */
export class AutoStrategy extends InterventionHandler {
  async onIntervention(): Promise<InterventionDecision> {
    return { action: "approve" };
  }
}

/**
 * Confirm strategy: requires user confirmation before proceeding.
 * In server mode, this is delegated to the frontend via WebSocket.
 * In standalone mode, it auto-approves.
 */
export class ConfirmStrategy extends InterventionHandler {
  async onIntervention(point: InterventionPoint, context: InterventionContext): Promise<InterventionDecision> {
    // When used standalone (no WS bridge), auto-approve
    // When used with server, WSInterventionHandler takes over
    return { action: "approve" };
  }
}

/**
 * Review strategy: allows reviewing the action after execution.
 * In server mode, the review is sent to the frontend.
 * In standalone mode, it auto-approves.
 */
export class ReviewStrategy extends InterventionHandler {
  async onIntervention(point: InterventionPoint, context: InterventionContext): Promise<InterventionDecision> {
    return { action: "approve" };
  }
}

/**
 * Edit strategy: allows editing the input before execution.
 * In server mode, the edit form is sent to the frontend.
 * In standalone mode, it approves without changes.
 */
export class EditStrategy extends InterventionHandler {
  async onIntervention(point: InterventionPoint, context: InterventionContext): Promise<InterventionDecision> {
    return { action: "approve" };
  }
}

/**
 * Reject strategy: automatically rejects all interventions.
 */
export class RejectStrategy extends InterventionHandler {
  async onIntervention(): Promise<InterventionDecision> {
    return { action: "reject", reason: "Strategy configured to reject" };
  }
}

/**
 * Strategy factory: create an intervention handler from a strategy name.
 */
export function createStrategy(strategy: string): InterventionHandler {
  switch (strategy) {
    case "auto": return new AutoStrategy();
    case "confirm": return new ConfirmStrategy();
    case "review": return new ReviewStrategy();
    case "edit": return new EditStrategy();
    case "reject": return new RejectStrategy();
    default: return new AutoStrategy();
  }
}
