import type { SwarmConfig } from "../core/types.js";

export interface StoredMessage {
  id: string;
  agentId?: string;
  role: string;
  content?: string;
  thinking?: string;
  toolCalls?: string; // JSON
  toolCallId?: string;
  metadata?: string; // JSON
  timestamp: number;
}

export interface StoredEvent {
  id: string;
  agentId?: string;
  eventType: string;
  eventData?: string; // JSON
  timestamp: number;
}

export interface Conversation {
  id: string;
  swarmId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IStorage {
  init(): Promise<void>;
  close(): Promise<void>;

  // Swarm management
  saveSwarm(config: SwarmConfig): Promise<void>;
  loadSwarm(id: string): Promise<SwarmConfig | null>;
  listSwarms(): Promise<SwarmConfig[]>;
  deleteSwarm(id: string): Promise<void>;

  // Conversation management
  createConversation(swarmId: string, title?: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(swarmId: string): Promise<Conversation[]>;
  deleteConversation(id: string): Promise<void>;

  // Message management
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  getMessagesByAgent(conversationId: string, agentId: string): Promise<StoredMessage[]>;
  clearMessages(conversationId: string): Promise<void>;

  // Event log
  logEvent(conversationId: string, event: StoredEvent): Promise<void>;
  getEvents(conversationId: string, eventType?: string): Promise<StoredEvent[]>;
}
