import type { IStorage, StoredMessage, StoredEvent, Conversation } from "./interface.js";
import type { SwarmConfig } from "../core/types.js";

export class SqliteStorage implements IStorage {
  private db: any = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    // TODO: implement with better-sqlite3 + drizzle-orm
    // Will be implemented when integrating the full storage layer
    throw new Error("SqliteStorage.init() not implemented yet");
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async saveSwarm(_config: SwarmConfig): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async loadSwarm(_id: string): Promise<SwarmConfig | null> {
    throw new Error("Not implemented yet");
  }

  async listSwarms(): Promise<SwarmConfig[]> {
    throw new Error("Not implemented yet");
  }

  async deleteSwarm(_id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async createConversation(_swarmId: string, _title?: string): Promise<Conversation> {
    throw new Error("Not implemented yet");
  }

  async getConversation(_id: string): Promise<Conversation | null> {
    throw new Error("Not implemented yet");
  }

  async listConversations(_swarmId: string): Promise<Conversation[]> {
    throw new Error("Not implemented yet");
  }

  async deleteConversation(_id: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async appendMessage(_conversationId: string, _message: StoredMessage): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async getMessages(_conversationId: string): Promise<StoredMessage[]> {
    throw new Error("Not implemented yet");
  }

  async getMessagesByAgent(_conversationId: string, _agentId: string): Promise<StoredMessage[]> {
    throw new Error("Not implemented yet");
  }

  async clearMessages(_conversationId: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async logEvent(_conversationId: string, _event: StoredEvent): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async getEvents(_conversationId: string, _eventType?: string): Promise<StoredEvent[]> {
    throw new Error("Not implemented yet");
  }
}
