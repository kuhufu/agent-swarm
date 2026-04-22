import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const settingsTable = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const swarmsTable = sqliteTable("swarms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  config: text("config").notNull(), // JSON: SwarmConfig
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agentsTable = sqliteTable("agents", {
  id: text("id").primaryKey(),
  swarmId: text("swarm_id").notNull().references(() => swarmsTable.id),
  name: text("name").notNull(),
  config: text("config").notNull(), // JSON: SwarmAgentConfig
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  swarmId: text("swarm_id").notNull().references(() => swarmsTable.id),
  title: text("title"),
  enabledTools: text("enabled_tools").notNull().default("[]"),
  thinkModeEnabled: integer("think_mode_enabled").notNull().default(0),
  directProvider: text("direct_provider"),
  directModelId: text("direct_model_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id),
  agentId: text("agent_id").references(() => agentsTable.id),
  role: text("role").notNull(), // user / assistant / toolResult / system / notification
  content: text("content"),
  thinking: text("thinking"),
  toolCalls: text("tool_calls"), // JSON: ToolCall[]
  toolCallId: text("tool_call_id"),
  metadata: text("metadata"), // JSON
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const eventsTable = sqliteTable("events", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversationsTable.id),
  agentId: text("agent_id").references(() => agentsTable.id),
  eventType: text("event_type").notNull(),
  eventData: text("event_data"), // JSON
  timestamp: integer("timestamp").notNull(),
});
