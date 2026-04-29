import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const settingsTable = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const swarmsTable = sqliteTable("swarms", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  config: text("config").notNull(), // JSON: SwarmConfig
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agentsTable = sqliteTable("agents", {
  id: text("id").notNull(),
  swarmId: text("swarm_id").notNull().references(() => swarmsTable.id),
  name: text("name").notNull(),
  config: text("config").notNull(), // JSON: SwarmAgentConfig
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.swarmId, table.id] }),
]);

export const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  swarmId: text("swarm_id").notNull().references(() => swarmsTable.id),
  title: text("title"),
  enabledTools: text("enabled_tools").notNull().default("[]"),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  directProvider: text("direct_provider"),
  directModelId: text("direct_model_id"),
  contextResetAt: integer("context_reset_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id),
  agentId: text("agent_id"),
  role: text("role").notNull(), // user / assistant / toolResult / system / notification
  content: text("content"),
  thinking: text("thinking"),
  toolCalls: text("tool_calls"), // JSON: ToolCall[]
  toolCallId: text("tool_call_id"),
  metadata: text("metadata"), // JSON
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const presetAgentsTable = sqliteTable("preset_agents", {
  id: text("id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  provider: text("provider").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  category: text("category").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  builtIn: integer("built_in").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
]);

export const eventsTable = sqliteTable("events", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id),
  agentId: text("agent_id"),
  eventType: text("event_type").notNull(),
  eventData: text("event_data"), // JSON
  timestamp: integer("timestamp").notNull(),
});

export const agentTemplatesTable = sqliteTable("agent_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  provider: text("provider").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  category: text("category").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at").notNull(),
});

export const llmCallsTable = sqliteTable("llm_calls", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  agentId: text("agent_id"),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  promptTokens: integer("prompt_tokens").default(0),
  completionTokens: integer("completion_tokens").default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  cost: real("cost").default(0),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull().default("ok"),
  errorMessage: text("error_message"),
  timestamp: integer("timestamp").notNull(),
});
