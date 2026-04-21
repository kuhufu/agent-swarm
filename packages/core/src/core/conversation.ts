import type { SwarmConfig, SwarmEvent, InterventionPoint } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";

export type InterventionCallback = (
  point: InterventionPoint,
  context: any,
) => Promise<any>;

export class Conversation {
  private id?: string;
  private swarmConfig: SwarmConfig;
  private storage: IStorage;
  private interventionHandler?: InterventionHandler;
  private interventionCallback?: InterventionCallback;
  private abortController?: AbortController;

  constructor(
    swarmConfig: SwarmConfig,
    storage: IStorage,
    interventionHandler?: InterventionHandler,
  ) {
    this.swarmConfig = swarmConfig;
    this.storage = storage;
    this.interventionHandler = interventionHandler;
  }

  async *prompt(message: string): AsyncGenerator<SwarmEvent> {
    this.abortController = new AbortController();

    // Create conversation in storage
    const conv = await this.storage.createConversation(this.swarmConfig.id);
    this.id = conv.id;

    // Save user message
    await this.storage.appendMessage(conv.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    });

    // TODO: implement actual agent orchestration
    // For now, yield a placeholder swarm_end event
    yield {
      type: "swarm_start",
      swarmId: this.swarmConfig.id,
      conversationId: conv.id,
    } as SwarmEvent;

    // The actual mode execution will be implemented in modes/
    // This is the orchestration entry point

    yield {
      type: "swarm_end",
      swarmId: this.swarmConfig.id,
      conversationId: conv.id,
      finalMessage: "Not implemented yet",
    } as SwarmEvent;
  }

  onIntervention(callback: InterventionCallback): void {
    this.interventionCallback = callback;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async getHistory() {
    if (!this.id) return [];
    return this.storage.getMessages(this.id);
  }

  getId(): string | undefined {
    return this.id;
  }
}
