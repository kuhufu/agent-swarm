import type { InterventionDecision, InterventionContext } from "./types.js";
import { InterventionHandler } from "./handler.js";

export class AutoStrategy extends InterventionHandler {
  async onIntervention(): Promise<InterventionDecision> {
    return { action: "approve" };
  }
}

export class ConfirmStrategy extends InterventionHandler {
  async onIntervention(point: string, context: InterventionContext): Promise<InterventionDecision> {
    // In server mode, this will be delegated to the frontend via WebSocket
    // Default to approve for programmatic usage
    return { action: "approve" };
  }
}

export class ReviewStrategy extends InterventionHandler {
  async onIntervention(point: string, context: InterventionContext): Promise<InterventionDecision> {
    // Review after execution — approve by default
    return { action: "approve" };
  }
}

export class EditStrategy extends InterventionHandler {
  async onIntervention(point: string, context: InterventionContext): Promise<InterventionDecision> {
    // Allow editing — approve without changes by default
    return { action: "approve" };
  }
}

export class RejectStrategy extends InterventionHandler {
  async onIntervention(): Promise<InterventionDecision> {
    return { action: "reject", reason: "Strategy configured to reject" };
  }
}
