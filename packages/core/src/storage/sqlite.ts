import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, and } from "drizzle-orm";
import type {
  IStorage,
  StoredMessage,
  StoredEvent,
  Conversation,
  ConversationPreferences,
  ConversationDirectModel,
} from "./interface.js";
import type { SwarmConfig, AgentPreset } from "../core/types.js";
import { settingsTable, swarmsTable, agentsTable, conversationsTable, messagesTable, eventsTable, presetAgentsTable } from "./schema.js";

const DEFAULT_CONVERSATION_PREFERENCES: ConversationPreferences = {
  enabledTools: [],
  thinkingLevel: "medium",
};

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
        enabled_tools TEXT NOT NULL DEFAULT '[]',
        direct_provider TEXT,
        direct_model_id TEXT,
        context_reset_at INTEGER,
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
      CREATE TABLE IF NOT EXISTS preset_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        built_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.ensureConversationColumns();
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

  private normalizeEnabledTools(input: unknown): string[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const normalized = input
      .filter((tool): tool is string => typeof tool === "string")
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);

    return Array.from(new Set(normalized));
  }

  private parseStoredEnabledTools(input: unknown): string[] {
    if (typeof input !== "string" || input.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(input) as unknown;
      return this.normalizeEnabledTools(parsed);
    } catch {
      return [];
    }
  }

  private normalizeDirectModel(input: unknown): ConversationDirectModel | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return undefined;
    }
    const raw = input as Record<string, unknown>;
    const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
    const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
    if (!provider || !modelId) {
      return undefined;
    }
    return { provider, modelId };
  }

  private mapConversationRow(row: {
    id: string;
    swarmId: string;
    title: string | null;
    enabledTools: string | null;
    thinkingLevel: string | null;
    directProvider: string | null;
    directModelId: string | null;
    contextResetAt: number | null;
    createdAt: number;
    updatedAt: number;
  }): Conversation {
    const directProvider = typeof row.directProvider === "string" ? row.directProvider.trim() : "";
    const directModelId = typeof row.directModelId === "string" ? row.directModelId.trim() : "";
    return {
      id: row.id,
      swarmId: row.swarmId,
      title: row.title ?? undefined,
      enabledTools: this.parseStoredEnabledTools(row.enabledTools),
      thinkingLevel: row.thinkingLevel ?? "medium",
      directModel: (directProvider && directModelId)
        ? { provider: directProvider, modelId: directModelId }
        : undefined,
      contextResetAt: row.contextResetAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private ensureConversationColumns() {
    if (!this.rawDb) {
      return;
    }

    const tableInfo = this.rawDb.prepare("PRAGMA table_info(conversations)").all() as Array<{ name?: string }>;
    const columns = new Set(tableInfo.map((item) => item.name).filter((name): name is string => typeof name === "string"));
    let schemaChanged = false;

    if (!columns.has("enabled_tools")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN enabled_tools TEXT NOT NULL DEFAULT '[]';");
      schemaChanged = true;
    }
    if (!columns.has("direct_provider")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN direct_provider TEXT;");
      schemaChanged = true;
    }
    if (!columns.has("direct_model_id")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN direct_model_id TEXT;");
      schemaChanged = true;
    }
    if (!columns.has("context_reset_at")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN context_reset_at INTEGER;");
      schemaChanged = true;
    }
    if (!columns.has("thinking_level")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'medium';");
      schemaChanged = true;
    }

    // 开发阶段：字段变更后直接清理历史会话，避免历史脏数据影响渲染和运行时行为。
    if (schemaChanged) {
      this.rawDb.exec(`
        DELETE FROM events;
        DELETE FROM messages;
        DELETE FROM conversations;
      `);
    }
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
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }

    const deleteTx = this.rawDb.transaction((swarmId: string) => {
      this.rawDb!.prepare(`
        DELETE FROM messages
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE swarm_id = ?
        )
      `).run(swarmId);

      this.rawDb!.prepare(`
        DELETE FROM events
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE swarm_id = ?
        )
      `).run(swarmId);

      this.rawDb!.prepare("DELETE FROM conversations WHERE swarm_id = ?").run(swarmId);
      this.rawDb!.prepare("DELETE FROM agents WHERE swarm_id = ?").run(swarmId);
      this.rawDb!.prepare("DELETE FROM swarms WHERE id = ?").run(swarmId);
    });

    deleteTx(id);
  }

  // ── Conversation management ──

  async createConversation(
    swarmId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation> {
    const now = Date.now();
    const enabledTools = this.normalizeEnabledTools(
      preferences?.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
    );
    const thinkingLevel = preferences?.thinkingLevel ?? DEFAULT_CONVERSATION_PREFERENCES.thinkingLevel ?? "medium";
    const directModel = this.normalizeDirectModel(preferences?.directModel);
    const conv: Conversation = {
      id: crypto.randomUUID(),
      swarmId,
      title: title ?? "新对话",
      enabledTools,
      thinkingLevel,
      directModel,
      contextResetAt: undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.getDb().insert(conversationsTable).values({
      id: conv.id,
      swarmId: conv.swarmId,
      title: conv.title,
      enabledTools: JSON.stringify(conv.enabledTools),
      thinkingLevel: conv.thinkingLevel,
      directProvider: conv.directModel?.provider ?? null,
      directModelId: conv.directModel?.modelId ?? null,
      contextResetAt: null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }).run();
    return conv;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = this.getDb().select().from(conversationsTable).where(eq(conversationsTable.id, id)).all();
    if (rows.length === 0) return null;
    return this.mapConversationRow(rows[0]);
  }

  async listConversations(swarmId: string): Promise<Conversation[]> {
    const rows = this.getDb().select().from(conversationsTable)
      .where(eq(conversationsTable.swarmId, swarmId))
      .orderBy(desc(conversationsTable.updatedAt))
      .all();
    return rows.map((row) => this.mapConversationRow(row));
  }

  async listAllConversations(): Promise<Conversation[]> {
    const rows = this.getDb().select().from(conversationsTable)
      .orderBy(desc(conversationsTable.updatedAt))
      .all();
    return rows.map((row) => this.mapConversationRow(row));
  }

  async updateConversationPreferences(
    id: string,
    preferences: Partial<ConversationPreferences>,
  ): Promise<Conversation> {
    const current = await this.getConversation(id);
    if (!current) {
      throw new Error(`Conversation not found: ${id}`);
    }

    const enabledTools = preferences.enabledTools !== undefined
      ? this.normalizeEnabledTools(preferences.enabledTools)
      : current.enabledTools;
    const thinkingLevel = preferences.thinkingLevel ?? current.thinkingLevel;
    const directModel = preferences.directModel !== undefined
      ? this.normalizeDirectModel(preferences.directModel)
      : current.directModel;
    const now = Date.now();

    this.getDb().update(conversationsTable)
      .set({
        enabledTools: JSON.stringify(enabledTools),
        thinkingLevel,
        directProvider: directModel?.provider ?? null,
        directModelId: directModel?.modelId ?? null,
        updatedAt: now,
      })
      .where(eq(conversationsTable.id, id))
      .run();

    return {
      ...current,
      enabledTools,
      thinkingLevel,
      directModel,
      updatedAt: now,
    };
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    this.getDb().update(conversationsTable)
      .set({ title, updatedAt: Date.now() })
      .where(eq(conversationsTable.id, id))
      .run();
  }

  async updateConversationContextReset(id: string, contextResetAt: number): Promise<void> {
    this.getDb().update(conversationsTable)
      .set({
        contextResetAt,
        updatedAt: Date.now(),
      })
      .where(eq(conversationsTable.id, id))
      .run();
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

  // ── Agent preset management ──

  async saveAgentPreset(preset: AgentPreset): Promise<void> {
    const now = Date.now();
    this.getDb().insert(presetAgentsTable).values({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      systemPrompt: preset.systemPrompt,
      provider: preset.model.provider,
      modelId: preset.model.modelId,
      category: preset.category,
      tags: JSON.stringify(preset.tags),
      builtIn: preset.builtIn ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: presetAgentsTable.id,
      set: {
        name: preset.name,
        description: preset.description,
        systemPrompt: preset.systemPrompt,
        provider: preset.model.provider,
        modelId: preset.model.modelId,
        category: preset.category,
        tags: JSON.stringify(preset.tags),
        builtIn: preset.builtIn ? 1 : 0,
        updatedAt: now,
      },
    }).run();
  }

  async loadAgentPreset(id: string): Promise<AgentPreset | null> {
    const rows = this.getDb().select().from(presetAgentsTable).where(eq(presetAgentsTable.id, id)).all();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      systemPrompt: r.systemPrompt,
      model: { provider: r.provider, modelId: r.modelId },
      category: r.category,
      tags: this.parseTags(r.tags),
      builtIn: r.builtIn === 1,
    };
  }

  async listAgentPresets(): Promise<AgentPreset[]> {
    const rows = this.getDb().select().from(presetAgentsTable).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      systemPrompt: r.systemPrompt,
      model: { provider: r.provider, modelId: r.modelId },
      category: r.category,
      tags: this.parseTags(r.tags),
      builtIn: r.builtIn === 1,
    }));
  }

  async deleteAgentPreset(id: string): Promise<void> {
    this.getDb().delete(presetAgentsTable).where(eq(presetAgentsTable.id, id)).run();
  }

  private parseTags(input: string): string[] {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // ignore
    }
    return [];
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
