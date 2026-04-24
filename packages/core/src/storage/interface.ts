import type { SwarmConfig, AgentPreset } from "../core/types.js";

export interface StoredMessage {
  id: string;
  agentId?: string | null;
  role: string;
  content?: string | null;
  thinking?: string | null;
  toolCalls?: string | null; // JSON
  toolCallId?: string | null;
  metadata?: string | null; // JSON
  timestamp: number;
  createdAt?: number;
}

export interface StoredEvent {
  id: string;
  agentId?: string | null;
  eventType: string;
  eventData?: string | null; // JSON
  timestamp: number;
}

export interface Conversation {
  id: string;
  swarmId: string;
  title?: string;
  enabledTools: string[];
  thinkModeEnabled: boolean;
  directModel?: ConversationDirectModel;
  contextResetAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationDirectModel {
  provider: string;
  modelId: string;
}

export interface ConversationPreferences {
  enabledTools: string[];
  thinkModeEnabled: boolean;
  directModel?: ConversationDirectModel;
}

export interface IStorage {
  init(): Promise<void>;
  close(): Promise<void>;

  // Global settings
  saveSetting(key: string, value: string): Promise<void>;
  loadSetting(key: string): Promise<string | null>;

  // Swarm management
  saveSwarm(config: SwarmConfig): Promise<void>;
  loadSwarm(id: string): Promise<SwarmConfig | null>;
  listSwarms(): Promise<SwarmConfig[]>;
  deleteSwarm(id: string): Promise<void>;

  // Conversation management
  createConversation(
    swarmId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(swarmId: string): Promise<Conversation[]>;
  listAllConversations(): Promise<Conversation[]>;
  updateConversationPreferences(
    id: string,
    preferences: Partial<ConversationPreferences>,
  ): Promise<Conversation>;
  updateConversationTitle(id: string, title: string): Promise<void>;
  updateConversationContextReset(id: string, contextResetAt: number): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // Message management
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  getMessagesByAgent(conversationId: string, agentId: string): Promise<StoredMessage[]>;
  clearMessages(conversationId: string): Promise<void>;

  // Agent preset management
  saveAgentPreset(preset: AgentPreset): Promise<void>;
  loadAgentPreset(id: string): Promise<AgentPreset | null>;
  listAgentPresets(): Promise<AgentPreset[]>;
  deleteAgentPreset(id: string): Promise<void>;

  // Event log
  logEvent(conversationId: string, event: StoredEvent): Promise<void>;
  getEvents(conversationId: string, eventType?: string): Promise<StoredEvent[]>;
}
