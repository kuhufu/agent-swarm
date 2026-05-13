import type { SwarmEvent, SwarmAgentConfig, EventLogLevel } from "../types.js";
import type { IStorage } from "../../storage/interface.js";

const KEY_EVENT_TYPES = new Set<SwarmEvent["type"]>([
  "swarm_start",
  "swarm_end",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_end",
  "tool_execution_end",
  "handoff",
  "team_run_start",
  "team_run_update",
  "team_run_end",
  "team_task_created",
  "team_task_started",
  "team_task_update",
  "team_task_completed",
  "team_task_verification_started",
  "team_task_verification_passed",
  "team_task_verification_failed",
  "team_task_retry",
  "team_task_human_review_required",
  "intervention_required",
  "error",
]);

export class ConversationEventBus {
  private eventListeners: ((event: SwarmEvent) => void)[] = [];
  private storage: IStorage;
  private conversationId: string;
  private eventLogLevel: EventLogLevel;
  private agentNames: Map<string, string>;

  constructor(
    conversationId: string,
    storage: IStorage,
    swarmAgents: SwarmAgentConfig[],
    eventLogLevel: EventLogLevel,
  ) {
    this.conversationId = conversationId;
    this.storage = storage;
    this.eventLogLevel = eventLogLevel;
    this.agentNames = new Map(swarmAgents.map(a => [a.id, a.name]));
  }

  onEvent(fn: (event: SwarmEvent) => void): () => void {
    this.eventListeners.push(fn);
    return () => {
      this.eventListeners = this.eventListeners.filter(f => f !== fn);
    };
  }

  emit(event: SwarmEvent): void {
    this.ensureAgentName(event);
    this.persistIfNeeded(event);
    for (const fn of this.eventListeners) {
      fn(event);
    }
  }

  private ensureAgentName(event: SwarmEvent): void {
    if ("agentId" in event && typeof (event as any).agentId === "string" && !(event as any).agentName) {
      (event as any).agentName = this.agentNames.get((event as any).agentId) ?? (event as any).agentId;
    }
  }

  private persistIfNeeded(event: SwarmEvent): void {
    if (!this.shouldPersist(event)) return;
    void this.storage.logEvent(this.conversationId, {
      id: crypto.randomUUID(),
      agentId: null,
      eventType: event.type,
      eventData: JSON.stringify(this.serialize(event)),
      timestamp: Date.now(),
    }).catch(() => {});
  }

  private shouldPersist(event: SwarmEvent): boolean {
    if (this.eventLogLevel === "none") return false;
    if (this.eventLogLevel === "full") return true;
    return KEY_EVENT_TYPES.has(event.type);
  }

  private serialize(event: SwarmEvent): unknown {
    const serialized = { ...event } as Record<string, unknown>;
    if ("error" in serialized && serialized.error instanceof Error) {
      serialized.error = {
        name: serialized.error.name,
        message: serialized.error.message,
      };
    }
    if ("respond" in serialized) {
      delete serialized.respond;
    }
    return serialized;
  }
}
