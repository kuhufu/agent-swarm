import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, and, gt } from "drizzle-orm";
import type {
  IStorage,
  ConversationUsage,
  DailyUsage,
  LLMCallRecord,
  LLMCallQuery,
  StoredMessage,
  StoredEvent,
  Conversation,
  ConversationPreferences,
  ConversationDirectModel,
  StoredUser,
  PublicUser,
  UserRole,
} from "./interface.js";
import type { SwarmConfig, AgentPreset } from "../core/types.js";
import { settingsTable, swarmsTable, agentsTable, conversationsTable, messagesTable, eventsTable, presetAgentsTable, agentTemplatesTable, usersTable, llmCallsTable } from "./schema.js";

const DEFAULT_CONVERSATION_PREFERENCES: ConversationPreferences = {
  enabledTools: [],
  thinkingLevel: "off",
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
    this.resetDevelopmentSchemaIfOutdated();

    // Create tables if not exist
    this.rawDb.exec(`
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
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
        id TEXT NOT NULL,
        swarm_id TEXT NOT NULL REFERENCES swarms(id),
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (swarm_id, id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        swarm_id TEXT NOT NULL REFERENCES swarms(id),
        title TEXT,
        enabled_tools TEXT NOT NULL DEFAULT '[]',
        thinking_level TEXT NOT NULL DEFAULT 'off',
        direct_provider TEXT,
        direct_model_id TEXT,
        context_reset_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        agent_id TEXT,
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
        agent_id TEXT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversations_swarm ON conversations(swarm_id);
      CREATE TABLE IF NOT EXISTS preset_agents (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        built_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS agent_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS llm_calls (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_id TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok',
        error_message TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_calls_conversation ON llm_calls(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_llm_calls_status ON llm_calls(status, timestamp);
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

  private resetDevelopmentSchemaIfOutdated(): void {
    if (!this.rawDb) return;

    const hasTable = (table: string) => {
      const row = this.rawDb!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      return Boolean(row);
    };
    const tableInfo = (table: string) => this.rawDb!.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name?: string;
      pk?: number;
    }>;

    const agentsInfo = hasTable("agents") ? tableInfo("agents") : [];
    const presetInfo = hasTable("preset_agents") ? tableInfo("preset_agents") : [];
    const usersInfo = hasTable("users") ? tableInfo("users") : [];
    const agentIdPk = agentsInfo.find((column) => column.name === "id")?.pk ?? 0;
    const presetIdPk = presetInfo.find((column) => column.name === "id")?.pk ?? 0;
    const usersHasRole = usersInfo.some((column) => column.name === "role");

    if (
      (agentsInfo.length > 0 && agentIdPk === 1)
      || (presetInfo.length > 0 && presetIdPk === 1)
      || (usersInfo.length > 0 && !usersHasRole)
    ) {
      this.rawDb.exec(`
        PRAGMA foreign_keys = OFF;
        DROP TABLE IF EXISTS llm_calls;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversations;
        DROP TABLE IF EXISTS agents;
        DROP TABLE IF EXISTS swarms;
        DROP TABLE IF EXISTS preset_agents;
        DROP TABLE IF EXISTS agent_templates;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS settings;
        PRAGMA foreign_keys = ON;
      `);
    }
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
      thinkingLevel: row.thinkingLevel ?? "off",
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
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off';");
      schemaChanged = true;
    }
    if (!columns.has("user_id")) {
      this.rawDb.exec("ALTER TABLE conversations ADD COLUMN user_id TEXT;");
      schemaChanged = true;
    }

    // swarms table
    const swarmTableInfo = this.rawDb.prepare("PRAGMA table_info(swarms)").all() as Array<{ name?: string }>;
    if (!swarmTableInfo.find((c) => c.name === "user_id")) {
      this.rawDb.exec("ALTER TABLE swarms ADD COLUMN user_id TEXT;");
      schemaChanged = true;
    }

    // preset_agents table
    const presetTableInfo = this.rawDb.prepare("PRAGMA table_info(preset_agents)").all() as Array<{ name?: string }>;
    if (!presetTableInfo.find((c) => c.name === "user_id")) {
      this.rawDb.exec("ALTER TABLE preset_agents ADD COLUMN user_id TEXT;");
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

  // ── User management ──

  async createUser(user: StoredUser): Promise<void> {
    this.getDb().insert(usersTable).values({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      createdAt: user.createdAt,
    }).run();
  }

  async countUsers(): Promise<number> {
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }
    const row = this.rawDb.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return row.count;
  }

  private normalizeUserRole(role: string | null | undefined): UserRole {
    return role === "admin" ? "admin" : "user";
  }

  async getUserByUsername(username: string): Promise<StoredUser | null> {
    const rows = this.getDb().select().from(usersTable).where(eq(usersTable.username, username)).all();
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      role: this.normalizeUserRole(row.role),
      createdAt: row.createdAt,
    };
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    const rows = this.getDb().select({
      id: usersTable.id,
      username: usersTable.username,
      role: usersTable.role,
    }).from(usersTable).where(eq(usersTable.id, id)).all();
    if (rows.length === 0) return null;
    return {
      id: rows[0].id,
      username: rows[0].username,
      role: this.normalizeUserRole(rows[0].role),
    };
  }

  // ── LLM call log ──

  async logLLMCall(call: LLMCallRecord): Promise<void> {
    this.getDb().insert(llmCallsTable).values({
      id: call.id,
      conversationId: call.conversationId,
      agentId: call.agentId ?? null,
      providerId: call.providerId,
      modelId: call.modelId,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      cost: call.cost,
      latencyMs: call.latencyMs ?? null,
      status: call.status,
      errorMessage: call.errorMessage ?? null,
      timestamp: call.timestamp,
    }).run();
  }

  async queryLLMCalls(filter: LLMCallQuery, userId: string): Promise<LLMCallRecord[]> {
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }

    const whereClauses: string[] = ["c.user_id = ?"];
    const params: Array<string | number> = [userId];

    if (filter.conversationId) {
      whereClauses.push("l.conversation_id = ?");
      params.push(filter.conversationId);
    }
    if (filter.providerId) {
      whereClauses.push("l.provider_id = ?");
      params.push(filter.providerId);
    }
    if (filter.modelId) {
      whereClauses.push("l.model_id = ?");
      params.push(filter.modelId);
    }
    if (filter.days) {
      whereClauses.push("l.timestamp >= ?");
      params.push(Date.now() - filter.days * 86_400_000);
    }

    let sql = `
      SELECT
        l.id as id,
        l.conversation_id as conversationId,
        l.agent_id as agentId,
        l.provider_id as providerId,
        l.model_id as modelId,
        l.prompt_tokens as promptTokens,
        l.completion_tokens as completionTokens,
        l.cache_read_tokens as cacheReadTokens,
        l.cache_write_tokens as cacheWriteTokens,
        l.cost as cost,
        l.latency_ms as latencyMs,
        l.status as status,
        l.error_message as errorMessage,
        l.timestamp as timestamp
      FROM llm_calls l
      INNER JOIN conversations c ON c.id = l.conversation_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY l.timestamp DESC
    `;

    if (filter.limit && Number.isFinite(filter.limit) && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(Math.floor(filter.limit));
    }

    const rows = this.rawDb.prepare(sql).all(...params) as Array<{
      id: string;
      conversationId: string;
      agentId: string | null;
      providerId: string;
      modelId: string;
      promptTokens: number | null;
      completionTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      cost: number | null;
      latencyMs: number | null;
      status: string | null;
      errorMessage: string | null;
      timestamp: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      agentId: r.agentId ?? undefined,
      providerId: r.providerId,
      modelId: r.modelId,
      promptTokens: r.promptTokens ?? 0,
      completionTokens: r.completionTokens ?? 0,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheWriteTokens: r.cacheWriteTokens ?? 0,
      cost: r.cost ?? 0,
      latencyMs: r.latencyMs ?? undefined,
      status: (r.status ?? "ok") as "ok" | "error",
      errorMessage: r.errorMessage ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  // ── Swarm management ──

  async saveSwarm(config: SwarmConfig, userId: string): Promise<void> {
    const now = Date.now();
    const existing = this.getDb().select({
      userId: swarmsTable.userId,
    }).from(swarmsTable).where(eq(swarmsTable.id, config.id)).all();
    if (existing.length > 0 && existing[0].userId !== userId) {
      throw new Error(`Swarm id already exists for another user: ${config.id}`);
    }

    this.getDb().insert(swarmsTable).values({
      id: config.id,
      userId,
      name: config.name,
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: swarmsTable.id,
      set: { userId, name: config.name, config: JSON.stringify(config), updatedAt: now },
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
        target: [agentsTable.swarmId, agentsTable.id],
        set: {
          name: agent.name,
          config: JSON.stringify(serializableAgent),
          updatedAt: now,
        },
      }).run();
    }
  }

  async loadSwarm(id: string, userId: string): Promise<SwarmConfig | null> {
    const rows = this.getDb().select().from(swarmsTable).where(
      and(eq(swarmsTable.id, id), eq(swarmsTable.userId, userId)),
    ).all();
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].config);
  }

  async listSwarms(userId: string): Promise<SwarmConfig[]> {
    const rows = this.getDb().select().from(swarmsTable).where(eq(swarmsTable.userId, userId)).all();
    return rows.map((r) => JSON.parse(r.config));
  }

  async deleteSwarm(id: string, userId: string): Promise<void> {
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }

    const existing = this.getDb().select({
      id: swarmsTable.id,
    }).from(swarmsTable).where(
      and(eq(swarmsTable.id, id), eq(swarmsTable.userId, userId)),
    ).all();
    if (existing.length === 0) {
      throw new Error(`Swarm not found: ${id}`);
    }

    const deleteTx = this.rawDb.transaction((swarmId: string, ownerId: string) => {
      this.rawDb!.prepare(`
        DELETE FROM messages
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE swarm_id = ? AND user_id = ?
        )
      `).run(swarmId, ownerId);

      this.rawDb!.prepare(`
        DELETE FROM events
        WHERE conversation_id IN (
          SELECT id FROM conversations WHERE swarm_id = ? AND user_id = ?
        )
      `).run(swarmId, ownerId);

      this.rawDb!.prepare("DELETE FROM conversations WHERE swarm_id = ? AND user_id = ?").run(swarmId, ownerId);
      this.rawDb!.prepare("DELETE FROM agents WHERE swarm_id = ?").run(swarmId);
      this.rawDb!.prepare("DELETE FROM swarms WHERE id = ? AND user_id = ?").run(swarmId, ownerId);
    });

    deleteTx(id, userId);
  }

  // ── Conversation management ──

  async createConversation(
    swarmId: string,
    userId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation> {
    const now = Date.now();
    const enabledTools = this.normalizeEnabledTools(
      preferences?.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
    );
    const thinkingLevel = preferences?.thinkingLevel ?? DEFAULT_CONVERSATION_PREFERENCES.thinkingLevel ?? "off";
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
      userId,
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

  async getConversation(id: string, userId: string): Promise<Conversation | null> {
    const rows = this.getDb().select().from(conversationsTable).where(
      and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)),
    ).all();
    if (rows.length === 0) return null;
    return this.mapConversationRow(rows[0]);
  }

  async listConversations(swarmId: string, userId: string): Promise<Conversation[]> {
    const rows = this.getDb().select().from(conversationsTable)
      .where(and(eq(conversationsTable.swarmId, swarmId), eq(conversationsTable.userId, userId)))
      .orderBy(desc(conversationsTable.updatedAt))
      .all();
    return rows.map((row) => this.mapConversationRow(row));
  }

  async listAllConversations(userId: string): Promise<Conversation[]> {
    const rows = this.getDb().select().from(conversationsTable)
      .where(eq(conversationsTable.userId, userId))
      .orderBy(desc(conversationsTable.updatedAt))
      .all();
    return rows.map((row) => this.mapConversationRow(row));
  }

  async updateConversationPreferences(
    id: string,
    preferences: Partial<ConversationPreferences>,
    userId: string,
  ): Promise<Conversation> {
    const current = await this.getConversation(id, userId);
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
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)))
      .run();

    return {
      ...current,
      enabledTools,
      thinkingLevel,
      directModel,
      updatedAt: now,
    };
  }

  async updateConversationTitle(id: string, title: string, userId?: string): Promise<void> {
    this.getDb().update(conversationsTable)
      .set({ title, updatedAt: Date.now() })
      .where(userId
        ? and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId))
        : eq(conversationsTable.id, id))
      .run();
  }

  async updateConversationContextReset(id: string, contextResetAt: number, userId?: string): Promise<void> {
    this.getDb().update(conversationsTable)
      .set({
        contextResetAt,
        updatedAt: Date.now(),
      })
      .where(userId
        ? and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId))
        : eq(conversationsTable.id, id))
      .run();
  }

  async deleteConversation(id: string, userId: string): Promise<void> {
    const conversation = await this.getConversation(id, userId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
    }

    this.getDb().delete(messagesTable).where(eq(messagesTable.conversationId, id)).run();
    this.getDb().delete(eventsTable).where(eq(eventsTable.conversationId, id)).run();
    this.getDb().delete(conversationsTable).where(
      and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)),
    ).run();
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

  async getMessages(conversationId: string, since?: number): Promise<StoredMessage[]> {
    const conditions = [eq(messagesTable.conversationId, conversationId)];
    if (since !== undefined) {
      conditions.push(gt(messagesTable.createdAt, since));
    }
    const rows = this.getDb().select().from(messagesTable)
      .where(and(...conditions))
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

  async saveAgentPreset(preset: AgentPreset, userId: string): Promise<void> {
    const now = Date.now();

    this.getDb().insert(presetAgentsTable).values({
      id: preset.id,
      userId,
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
      target: [presetAgentsTable.userId, presetAgentsTable.id],
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

  async loadAgentPreset(id: string, userId: string): Promise<AgentPreset | null> {
    const rows = this.getDb().select().from(presetAgentsTable).where(
      and(eq(presetAgentsTable.id, id), eq(presetAgentsTable.userId, userId)),
    ).all();
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

  async listAgentPresets(userId: string): Promise<AgentPreset[]> {
    const rows = this.getDb().select().from(presetAgentsTable)
      .where(eq(presetAgentsTable.userId, userId))
      .all();
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

  async deleteAgentPreset(id: string, userId: string): Promise<void> {
    this.getDb().delete(presetAgentsTable).where(
      and(eq(presetAgentsTable.id, id), eq(presetAgentsTable.userId, userId)),
    ).run();
  }

  // ── Agent template management (system-level) ──

  async saveAgentTemplate(template: AgentPreset): Promise<void> {
    const now = Date.now();
    this.getDb().insert(agentTemplatesTable).values({
      id: template.id,
      name: template.name,
      description: template.description,
      systemPrompt: template.systemPrompt,
      provider: template.model.provider,
      modelId: template.model.modelId,
      category: template.category,
      tags: JSON.stringify(template.tags),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: agentTemplatesTable.id,
      set: {
        name: template.name,
        description: template.description,
        systemPrompt: template.systemPrompt,
        provider: template.model.provider,
        modelId: template.model.modelId,
        category: template.category,
        tags: JSON.stringify(template.tags),
        updatedAt: now,
      },
    }).run();
  }

  async loadAgentTemplate(id: string): Promise<AgentPreset | null> {
    const rows = this.getDb().select().from(agentTemplatesTable)
      .where(eq(agentTemplatesTable.id, id)).all();
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
      builtIn: true,
    };
  }

  async listAgentTemplates(): Promise<AgentPreset[]> {
    const rows = this.getDb().select().from(agentTemplatesTable).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      systemPrompt: r.systemPrompt,
      model: { provider: r.provider, modelId: r.modelId },
      category: r.category,
      tags: this.parseTags(r.tags),
      builtIn: true,
    }));
  }

  async deleteAgentTemplate(id: string): Promise<void> {
    this.getDb().delete(agentTemplatesTable)
      .where(eq(agentTemplatesTable.id, id)).run();
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

  async getConversationUsage(conversationId: string, userId: string): Promise<ConversationUsage[]> {
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }

    const rows = this.rawDb.prepare(`
      SELECT m.metadata AS metadata
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ?
        AND m.role = 'assistant'
        AND c.user_id = ?
    `).all(conversationId, userId) as Array<{ metadata: string | null }>;

    const usageMap = new Map<string, ConversationUsage>();

    for (const row of rows) {
      if (!row.metadata) continue;
      try {
        const meta = JSON.parse(row.metadata) as Record<string, unknown>;
        const provider = (meta.provider as string) ?? "unknown";
        const modelId = (meta.model as string) ?? "unknown";
        const usage = meta.usage as Record<string, unknown> | undefined;
        if (!usage) continue;

        const key = `${provider}:${modelId}`;
        const existing = usageMap.get(key) ?? {
          conversationId,
          provider,
          modelId,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0,
        };

        existing.totalInputTokens += (usage.input as number) ?? 0;
        existing.totalOutputTokens += (usage.output as number) ?? 0;
        existing.totalTokens = existing.totalInputTokens + existing.totalOutputTokens;
        const cost = usage.cost as Record<string, unknown> | undefined;
        existing.totalCost += (cost?.total as number) ?? 0;
        usageMap.set(key, existing);
      } catch {
        // skip malformed metadata
      }
    }

    return Array.from(usageMap.values());
  }

  async getDailyUsage(userId: string, days = 30): Promise<DailyUsage[]> {
    if (!this.rawDb) {
      throw new Error("Storage not initialized");
    }

    const since = Date.now() - days * 86_400_000;
    const rows = this.rawDb.prepare(`
      SELECT
        m.metadata AS metadata,
        m.timestamp AS timestamp
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant'
        AND m.timestamp >= ?
        AND c.user_id = ?
    `).all(since, userId) as Array<{ metadata: string | null; timestamp: number }>;

    const usageMap = new Map<string, DailyUsage>();

    for (const row of rows) {
      if (!row.metadata) continue;
      try {
        const meta = JSON.parse(row.metadata) as Record<string, unknown>;
        const provider = (meta.provider as string) ?? "unknown";
        const modelId = (meta.model as string) ?? "unknown";
        const usage = meta.usage as Record<string, unknown> | undefined;
        if (!usage) continue;

        const date = new Date(row.timestamp).toISOString().slice(0, 10);
        const key = `${date}:${provider}:${modelId}`;
        const existing = usageMap.get(key) ?? {
          date,
          provider,
          modelId,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
        };

        existing.inputTokens += (usage.input as number) ?? 0;
        existing.outputTokens += (usage.output as number) ?? 0;
        existing.totalTokens = existing.inputTokens + existing.outputTokens;
        const cost = usage.cost as Record<string, unknown> | undefined;
        existing.cost += (cost?.total as number) ?? 0;
        usageMap.set(key, existing);
      } catch {
        // skip malformed metadata
      }
    }

    return Array.from(usageMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }
}
