import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, and } from "drizzle-orm";
import type { IStorage, StoredMessage, StoredEvent, Conversation } from "./interface.js";
import type { SwarmConfig } from "../core/types.js";
import { settingsTable, swarmsTable, agentsTable, conversationsTable, messagesTable, eventsTable } from "./schema.js";

export class SqliteStorage implements IStorage {
  private db: ReturnType<typeof drizzle> | null = null;
  private rawDb: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    // Ensure directory exists
    const fs = await import("fs");
    const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf("/"));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.rawDb = new Database(this.dbPath);
    this.rawDb.pragma("journal_mode = WAL");
    this.rawDb.pragma("foreign_keys = ON");

    this.db = drizzle(this.rawDb);

    // Create tables if not exist
    this.rawDb.exec(`
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL REFERENCES swarms(id),
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL REFERENCES swarms(id),
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        agent_id TEXT REFERENCES agents(id),
        role TEXT NOT NULL,
        content TEXT,
        thinking TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        agent_id TEXT REFERENCES agents(id),
        event_type TEXT NOT NULL,
        event_data TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversations_swarm ON conversations(swarm_id);
    `);
  }

  async close(): Promise<void> {
    if (this.rawDb) {
      this.rawDb.close();
      this.rawDb = null;
      this.db = null;
    }
  }

  private getDb() {
    if (!this.db) throw new Error("Storage not initialized");
    return this.db;
  }

  // ── Global settings ──

  async saveSetting(key: string, value: string): Promise<void> {
    const now = Date.now();
    this.getDb().insert(settingsTable).values({
      key,
      value,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: now },
    }).run();
  }

  async loadSetting(key: string): Promise<string | null> {
    const rows = this.getDb().select().from(settingsTable).where(eq(settingsTable.key, key)).all();
    if (rows.length === 0) return null;
    return rows[0].value;
  }

  // ── Swarm management ──

  async saveSwarm(config: SwarmConfig): Promise<void> {
    const now = Date.now();
    this.getDb().insert(swarmsTable).values({
      id: config.id,
      name: config.name,
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: swarmsTable.id,
      set: { name: config.name, config: JSON.stringify(config), updatedAt: now },
    }).run();

    const agents = [...config.agents];
    if (config.orchestrator && !agents.some((agent) => agent.id === config.orchestrator!.id)) {
      agents.push(config.orchestrator);
    }

    for (const agent of agents) {
      const serializableAgent = { ...agent, tools: undefined };
      this.getDb().insert(agentsTable).values({
        id: agent.id,
        swarmId: config.id,
        name: agent.name,
        config: JSON.stringify(serializableAgent),
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: agentsTable.id,
        set: {
          swarmId: config.id,
          name: agent.name,
          config: JSON.stringify(serializableAgent),
          updatedAt: now,
        },
      }).run();
    }
  }

  async loadSwarm(id: string): Promise<SwarmConfig | null> {
    const rows = this.getDb().select().from(swarmsTable).where(eq(swarmsTable.id, id)).all();
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].config);
  }

  async listSwarms(): Promise<SwarmConfig[]> {
    const rows = this.getDb().select().from(swarmsTable).all();
    return rows.map((r) => JSON.parse(r.config));
  }

  async deleteSwarm(id: string): Promise<void> {
    this.getDb().delete(swarmsTable).where(eq(swarmsTable.id, id)).run();
  }

  // ── Conversation management ──

  async createConversation(swarmId: string, title?: string): Promise<Conversation> {
    const now = Date.now();
    const conv: Conversation = {
      id: crypto.randomUUID(),
      swarmId,
      title: title ?? "新对话",
      createdAt: now,
      updatedAt: now,
    };
    this.getDb().insert(conversationsTable).values({
      id: conv.id,
      swarmId: conv.swarmId,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }).run();
    return conv;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = this.getDb().select().from(conversationsTable).where(eq(conversationsTable.id, id)).all();
    if (rows.length === 0) return null;
    const r = rows[0];
    return { id: r.id, swarmId: r.swarmId, title: r.title ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  async listConversations(swarmId: string): Promise<Conversation[]> {
    const rows = this.getDb().select().from(conversationsTable)
      .where(eq(conversationsTable.swarmId, swarmId))
      .orderBy(desc(conversationsTable.updatedAt))
      .all();
    return rows.map((r) => ({
      id: r.id, swarmId: r.swarmId, title: r.title ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  }

  async deleteConversation(id: string): Promise<void> {
    this.getDb().delete(messagesTable).where(eq(messagesTable.conversationId, id)).run();
    this.getDb().delete(eventsTable).where(eq(eventsTable.conversationId, id)).run();
    this.getDb().delete(conversationsTable).where(eq(conversationsTable.id, id)).run();
  }

  // ── Message management ──

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    this.getDb().insert(messagesTable).values({
      id: message.id || crypto.randomUUID(),
      conversationId,
      agentId: message.agentId ?? null,
      role: message.role,
      content: message.content ?? null,
      thinking: message.thinking ?? null,
      toolCalls: message.toolCalls ?? null,
      toolCallId: message.toolCallId ?? null,
      metadata: message.metadata ?? null,
      timestamp: message.timestamp,
      createdAt: message.createdAt ?? Date.now(),
    }).run();

    // Update conversation updatedAt
    this.getDb().update(conversationsTable)
      .set({ updatedAt: Date.now() })
      .where(eq(conversationsTable.id, conversationId))
      .run();
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const rows = this.getDb().select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.timestamp)
      .all();
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      role: r.role,
      content: r.content,
      thinking: r.thinking,
      toolCalls: r.toolCalls,
      toolCallId: r.toolCallId,
      metadata: r.metadata,
      timestamp: r.timestamp,
      createdAt: r.createdAt ?? undefined,
    }));
  }

  async getMessagesByAgent(conversationId: string, agentId: string): Promise<StoredMessage[]> {
    const rows = this.getDb().select().from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.agentId, agentId)))
      .orderBy(messagesTable.timestamp)
      .all();
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      role: r.role,
      content: r.content,
      thinking: r.thinking,
      toolCalls: r.toolCalls,
      toolCallId: r.toolCallId,
      metadata: r.metadata,
      timestamp: r.timestamp,
      createdAt: r.createdAt ?? undefined,
    }));
  }

  async clearMessages(conversationId: string): Promise<void> {
    this.getDb().delete(messagesTable).where(eq(messagesTable.conversationId, conversationId)).run();
  }

  // ── Event log ──

  async logEvent(conversationId: string, event: StoredEvent): Promise<void> {
    this.getDb().insert(eventsTable).values({
      id: event.id || crypto.randomUUID(),
      conversationId,
      agentId: event.agentId ?? null,
      eventType: event.eventType,
      eventData: event.eventData ?? null,
      timestamp: event.timestamp,
    }).run();
  }

  async getEvents(conversationId: string, eventType?: string): Promise<StoredEvent[]> {
    const conditions = eventType
      ? and(eq(eventsTable.conversationId, conversationId), eq(eventsTable.eventType, eventType))
      : eq(eventsTable.conversationId, conversationId);

    const rows = this.getDb().select().from(eventsTable)
      .where(conditions)
      .orderBy(eventsTable.timestamp)
      .all();
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      eventType: r.eventType,
      eventData: r.eventData,
      timestamp: r.timestamp,
    }));
  }
}
