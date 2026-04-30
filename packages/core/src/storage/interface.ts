import type { SwarmConfig, AgentPreset } from "../core/types.js";

export type UserRole = "admin" | "user";

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
}

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
  thinkingLevel: string;
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
  thinkingLevel?: string;
  directModel?: ConversationDirectModel;
}

export interface ConversationUsage {
  conversationId: string;
  conversationTitle?: string;
  provider: string;
  modelId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface DailyUsage {
  date: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

export interface LLMCallRecord {
  id: string;
  conversationId: string;
  agentId?: string;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  latencyMs?: number;
  status: "ok" | "error";
  errorMessage?: string;
  timestamp: number;
}

export interface LLMCallQuery {
  conversationId?: string;
  providerId?: string;
  modelId?: string;
  days?: number;
  limit?: number;
}

export interface IStorage {
  init(): Promise<void>;
  close(): Promise<void>;

  // Global settings
  saveSetting(key: string, value: string): Promise<void>;
  loadSetting(key: string): Promise<string | null>;

  // User management
  createUser(user: StoredUser): Promise<void>;
  countUsers(): Promise<number>;
  getUserByUsername(username: string): Promise<StoredUser | null>;
  getUserById(id: string): Promise<PublicUser | null>;

  // Swarm management
  saveSwarm(config: SwarmConfig, userId: string): Promise<void>;
  loadSwarm(id: string, userId: string): Promise<SwarmConfig | null>;
  listSwarms(userId: string): Promise<SwarmConfig[]>;
  deleteSwarm(id: string, userId: string): Promise<void>;

  // Conversation management
  createConversation(
    swarmId: string,
    userId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation>;
  getConversation(id: string, userId: string): Promise<Conversation | null>;
  listConversations(swarmId: string, userId: string): Promise<Conversation[]>;
  listAllConversations(userId: string): Promise<Conversation[]>;
  updateConversationPreferences(
    id: string,
    preferences: Partial<ConversationPreferences>,
    userId: string,
  ): Promise<Conversation>;
  updateConversationTitle(id: string, title: string, userId?: string): Promise<void>;
  updateConversationContextReset(id: string, contextResetAt: number, userId?: string): Promise<void>;
  deleteConversation(id: string, userId: string): Promise<void>;

  // Message management
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  getMessages(conversationId: string, since?: number): Promise<StoredMessage[]>;
  getMessagesByAgent(conversationId: string, agentId: string): Promise<StoredMessage[]>;
  clearMessages(conversationId: string): Promise<void>;

  // Agent preset management
  saveAgentPreset(preset: AgentPreset, userId: string): Promise<void>;
  loadAgentPreset(id: string, userId: string): Promise<AgentPreset | null>;
  listAgentPresets(userId: string): Promise<AgentPreset[]>;
  deleteAgentPreset(id: string, userId: string): Promise<void>;

  // Agent template management (system-level, shared across users)
  saveAgentTemplate(template: AgentPreset): Promise<void>;
  loadAgentTemplate(id: string): Promise<AgentPreset | null>;
  listAgentTemplates(): Promise<AgentPreset[]>;
  deleteAgentTemplate(id: string): Promise<void>;

  // Event log
  logEvent(conversationId: string, event: StoredEvent): Promise<void>;
  getEvents(conversationId: string, eventType?: string): Promise<StoredEvent[]>;

  // Usage analytics
  getConversationUsage(conversationId: string, userId: string): Promise<ConversationUsage[]>;
  getDailyUsage(userId: string, days?: number): Promise<DailyUsage[]>;

  // LLM call log
  logLLMCall(call: LLMCallRecord): Promise<void>;
  queryLLMCalls(filter: LLMCallQuery, userId: string): Promise<LLMCallRecord[]>;
}
