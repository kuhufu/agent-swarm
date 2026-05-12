import type { SwarmConfig, AgentSwarmRootConfig, LLMBackendConfig, EventLogLevel, AgentPreset } from "./types.js";
import type { IStorage, LLMCallRecord, LLMCallQuery, StoredUser, PublicUser, StoredEvent } from "../storage/interface.js";
import type { Conversation as StoredConversation, ConversationPreferences } from "../storage/interface.js";
import type { StoredMessage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { Conversation } from "./conversation.js";
import { PRESET_AGENTS } from "./presets.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Logger } from "../logger/types.js";
import { ConsoleLogger } from "../logger/console-logger.js";
import type { WebSearchConfig } from "../tools/web-search.js";
import type { WebFetchConfig } from "../tools/web-fetch.js";
import { MCPClient } from "../tools/mcp/client.js";
import type { MCPServerConfig } from "../tools/mcp/client.js";
import type { IVectorStore } from "../storage/vector-store.js";
import type { IWikiStore } from "../storage/wiki-store.js";
import type { ToolRuntimeAvailability } from "../tools/runtime.js";
import { createRuntimeTool } from "../tools/runtime.js";
import { createAllMCPTools } from "../tools/mcp/tool-provider.js";
import { createRetrieveKnowledgeTool } from "../tools/retrieve-knowledge.js";
import { createSearchWikiTool } from "../tools/search-wiki.js";
import { createWorkspaceManager } from "../tools/workspace/manager.js";
import { createWorkspaceTool } from "../tools/workspace/tool-set.js";
import { ProviderModelManager } from "./swarm/provider-models.js";
import type { ProviderInfo, ModelInfo } from "./swarm/provider-models.js";
import { ModelTester } from "./swarm/model-tester.js";
import type { ModelConnectionTestOptions, ModelConnectionTestResult } from "./swarm/model-tester.js";
import { WikiGenerator } from "./swarm/wiki-generator.js";

export type { ProviderInfo, ModelInfo } from "./swarm/provider-models.js";
export type { ModelConnectionTestOptions, ModelConnectionTestResult } from "./swarm/model-tester.js";

export interface AgentSwarmOptions {
  configPath?: string;
  config?: AgentSwarmRootConfig;
  storage?: IStorage;
  interventionHandler?: InterventionHandler;
  logger?: Logger;
  webSearchConfig?: WebSearchConfig;
  webFetchConfig?: WebFetchConfig;
  mcpServers?: MCPServerConfig[];
  vectorStore?: IVectorStore;
  wikiStore?: IWikiStore;
}

export interface ConversationContextClearResult {
  conversationId: string;
  contextResetAt: number;
  markerMessage: StoredMessage;
}

export class AgentSwarm {
  private static readonly LLM_CONFIG_KEY = "llm_config";
  private static readonly DIRECT_SWARM_ID = "__direct_chat";

  private config: AgentSwarmRootConfig;
  private readonly eventLogLevel: EventLogLevel;
  private storage: IStorage;
  private interventionHandler?: InterventionHandler;
  private swarmConfigs: Map<string, SwarmConfig> = new Map();
  private seededUserIds: Set<string> = new Set();
  private templatesSeeded = false;
  private _initialized = false;
  public readonly logger: Logger;
  public readonly webSearchConfig?: WebSearchConfig;
  public readonly webFetchConfig?: WebFetchConfig;
  public readonly mcpClient: MCPClient;
  public readonly vectorStore?: IVectorStore;
  public readonly wikiStore?: IWikiStore;
  private readonly mcpServerConfigs?: MCPServerConfig[];

  private readonly providerModels: ProviderModelManager;
  private readonly modelTester: ModelTester;
  readonly wikiGenerator?: WikiGenerator;

  constructor(options: AgentSwarmOptions) {
    if (!options.config && !options.configPath) {
      throw new Error("Either config or configPath must be provided");
    }

    this.config = options.config ?? this.loadConfigFromPath(options.configPath!);
    this.eventLogLevel = this.normalizeEventLogLevel(this.config.eventLogLevel);
    this.config.eventLogLevel = this.eventLogLevel;
    this.storage = options.storage ?? new SqliteStorage(this.config.storage.path);
    this.interventionHandler = options.interventionHandler;
    this.logger = options.logger ?? new ConsoleLogger();
    this.webSearchConfig = options.webSearchConfig;
    this.webFetchConfig = options.webFetchConfig;
    this.mcpClient = new MCPClient();
    this.mcpServerConfigs = options.mcpServers;
    this.vectorStore = options.vectorStore;
    this.wikiStore = options.wikiStore;

    this.providerModels = new ProviderModelManager(() => this.config.llm, this.logger);
    this.modelTester = new ModelTester(() => this.config.llm, this.logger);
    this.wikiGenerator = options.wikiStore
      ? new WikiGenerator(() => this.config.llm, options.wikiStore, this.logger)
      : undefined;

    // Bootstrap in-memory index from startup config before init.
    for (const swarm of this.config.swarms) {
      this.swarmConfigs.set(swarm.id, swarm);
    }
  }

  async init(): Promise<void> {
    if (this._initialized) return;

    await this.storage.init();
    this.logger.info("storage_initialized", { type: this.config.storage.type });

    const storedLLMConfig = await this.storage.loadSetting(AgentSwarm.LLM_CONFIG_KEY);
    if (storedLLMConfig) {
      try {
        this.config.llm = JSON.parse(storedLLMConfig) as LLMBackendConfig;
      } catch {
        await this.storage.saveSetting(AgentSwarm.LLM_CONFIG_KEY, JSON.stringify(this.config.llm));
      }
    } else {
      await this.storage.saveSetting(AgentSwarm.LLM_CONFIG_KEY, JSON.stringify(this.config.llm));
    }

    this._initialized = true;

    // Seed system agent templates (once globally)
    await this.ensureTemplatesSeeded();

    // Connect MCP servers (non-blocking)
    if (this.mcpServerConfigs) {
      for (const server of this.mcpServerConfigs) {
        this.mcpClient.connect(server.id, server).catch((err) => {
          this.logger.warn("mcp_connect_failed", { serverId: server.id, error: err.message });
        });
      }
    }
  }

  // ── Conversation lifecycle ──

  async createConversation(
    userId: string,
    swarmId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
    workspaceId?: string | null,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    const swarmConfig = await this.storage.loadSwarm(swarmId, normalizedUserId);
    if (!swarmConfig) {
      throw new Error(`Swarm not found: ${swarmId}`);
    }
    await this.validateWorkspace(workspaceId, normalizedUserId);

    const conv = await this.storage.createConversation(swarmId, normalizedUserId, title, preferences, workspaceId);
    return this.createConversationInstance(conv.id, normalizedUserId, swarmConfig, [], conv.workspaceId);
  }

  async forkConversation(
    sourceConversationId: string,
    options: { swarmId?: string; title?: string; messageId?: string },
    userId: string,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const source = await this.storage.getConversation(sourceConversationId, normalizedUserId);
    if (!source) throw new Error(`Source conversation not found: ${sourceConversationId}`);

    const swarmId = options.swarmId ?? source.swarmId;
    const swarmConfig = await this.storage.loadSwarm(swarmId, normalizedUserId);
    if (!swarmConfig) throw new Error(`Target swarm not found: ${swarmId}`);

    const sourceMessages = await this.storage.getMessages(sourceConversationId);
    let messagesToCopy = sourceMessages;
    if (options.messageId) {
      const messageIndex = sourceMessages.findIndex((message) => message.id === options.messageId);
      if (messageIndex < 0) throw new Error(`Message not found: ${options.messageId}`);
      messagesToCopy = sourceMessages.slice(0, messageIndex + 1);
    }

    const newConv = await this.storage.createConversation(
      swarmId,
      normalizedUserId,
      options.title ?? `${source.title ?? "对话"} (分支)`,
      { enabledTools: source.enabledTools, thinkingLevel: source.thinkingLevel, directModel: source.directModel },
      source.workspaceId,
    );

    for (const msg of messagesToCopy) {
      await this.storage.appendMessage(newConv.id, { ...msg, id: crypto.randomUUID() });
    }

    // Preserve context reset boundary
    const lastCopiedMessage = messagesToCopy[messagesToCopy.length - 1];
    const lastCopiedCreatedAt = lastCopiedMessage
      ? (lastCopiedMessage.createdAt ?? lastCopiedMessage.timestamp)
      : undefined;
    if (
      source.contextResetAt
      && typeof lastCopiedCreatedAt === "number"
      && lastCopiedCreatedAt >= source.contextResetAt
    ) {
      await this.storage.updateConversationContextReset(newConv.id, source.contextResetAt, normalizedUserId);
    }

    return this.createConversationInstance(newConv.id, normalizedUserId, swarmConfig, [], newConv.workspaceId);
  }

  async createDirectConversation(
    userId: string,
    provider: string,
    modelId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
    workspaceId?: string | null,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);

    const swarmId = this.getDirectSwarmId(normalizedUserId);
    const agentId = `direct-agent`;

    const directSwarm: SwarmConfig = {
      id: swarmId,
      name: `${provider}/${modelId}`,
      mode: "sequential",
      agents: [{
        id: agentId,
        name: `${provider}/${modelId}`,
        description: `Direct chat with ${provider}/${modelId}`,
        systemPrompt: "You are a helpful assistant.",
        model: { provider, modelId },
      }],
    };

    this.swarmConfigs.set(swarmId, directSwarm);
    try {
      await this.storage.saveSwarm(directSwarm, normalizedUserId);
    } catch {
      // If saveSwarm fails, keep in-memory config available.
    }

    await this.validateWorkspace(workspaceId, normalizedUserId);

    const conv = await this.storage.createConversation(swarmId, normalizedUserId, title, {
      ...preferences,
      directModel: { provider, modelId },
    }, workspaceId);

    return this.createConversationInstance(conv.id, normalizedUserId, directSwarm, [], conv.workspaceId);
  }

  async resumeConversation(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);

    const conv = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

    const swarmConfig = await this.storage.loadSwarm(conv.swarmId, normalizedUserId);
    if (!swarmConfig) throw new Error(`Swarm not found: ${conv.swarmId}`);

    const storedMessages = await this.storage.getMessages(conversationId);
    const contextResetAt = conv.contextResetAt;
    const restoredMessages = typeof contextResetAt === "number"
      ? storedMessages.filter((message) => (message.createdAt ?? message.timestamp) > contextResetAt)
      : storedMessages;

    return this.createConversationInstance(
      conv.id,
      normalizedUserId,
      this.applyConversationDirectModel(swarmConfig, conv),
      restoredMessages,
      conv.workspaceId,
    );
  }

  createToolRuntimeAvailability(context: {
    conversationId: string;
    userId: string;
    workspaceId?: string;
  }): ToolRuntimeAvailability {
    const runtimeTools = context.workspaceId
      ? [createWorkspaceTool(createWorkspaceManager(context.workspaceId))]
      : [];

    if (this.vectorStore) {
      runtimeTools.push(createRuntimeTool(
        createRetrieveKnowledgeTool(this.vectorStore, { userId: context.userId }),
      ));
    }

    if (this.wikiStore) {
      runtimeTools.push(createRuntimeTool(
        createSearchWikiTool(this.wikiStore, { userId: context.userId }),
      ));
    }

    return {
      webSearchConfig: this.webSearchConfig,
      webFetchConfig: this.webFetchConfig,
      mcpTools: createAllMCPTools(this.mcpClient),
      runtimeTools,
    };
  }

  async clearConversationContext(
    conversationId: string,
    userId: string,
  ): Promise<ConversationContextClearResult> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);

    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const contextResetAt = Date.now();
    await this.storage.updateConversationContextReset(conversationId, contextResetAt, normalizedUserId);

    const markerMessage: StoredMessage = {
      id: crypto.randomUUID(),
      agentId: null,
      role: "notification",
      content: "已清空上下文，后续回复仅基于新消息。",
      metadata: JSON.stringify({ type: "context_cleared", contextResetAt }),
      timestamp: contextResetAt,
      createdAt: contextResetAt,
    };
    await this.storage.appendMessage(conversationId, markerMessage);

    return { conversationId, contextResetAt, markerMessage };
  }

  // ── Conversation queries ──

  async listConversations(swarmId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.listConversations(swarmId, normalizedUserId);
  }

  async listAllConversations(userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.listAllConversations(normalizedUserId);
  }

  async getConversation(conversationId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.getConversation(conversationId, normalizedUserId);
  }

  async updateConversationPreferences(
    conversationId: string,
    preferences: Partial<ConversationPreferences>,
    userId: string,
  ) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.updateConversationPreferences(conversationId, preferences, normalizedUserId);
  }

  async updateConversationWorkspace(conversationId: string, workspaceId: string | null, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.updateConversationWorkspace(conversationId, workspaceId, normalizedUserId);
  }

  async deleteConversation(id: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(id, normalizedUserId);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    await this.storage.deleteConversation(id, normalizedUserId);
  }

  async getMessages(conversationId: string, userId: string, since?: number) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    return this.storage.getMessages(conversationId, since);
  }

  async getConversationEvents(conversationId: string, userId: string, eventType?: string): Promise<StoredEvent[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    return this.storage.getEvents(conversationId, eventType);
  }

  // ── LLM config ──

  getLLMConfig(): LLMBackendConfig {
    return this.cloneLLMConfig(this.config.llm);
  }

  async updateLLMConfig(nextConfig: LLMBackendConfig): Promise<LLMBackendConfig> {
    this.ensureInitialized();
    this.config.llm = this.cloneLLMConfig(nextConfig);
    await this.storage.saveSetting(AgentSwarm.LLM_CONFIG_KEY, JSON.stringify(this.config.llm));
    this.logger.info("llm_config_updated", { providers: Object.keys(nextConfig.apiKeys) });
    return this.cloneLLMConfig(this.config.llm);
  }

  // ── Provider / Model ──

  listProviders(): ProviderInfo[] {
    return this.providerModels.listProviders();
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    return this.providerModels.listModels(providerId);
  }

  // ── Model test ──

  async testModelConnection(options: ModelConnectionTestOptions): Promise<ModelConnectionTestResult> {
    return this.modelTester.testConnection(options);
  }

  // ── Wiki generation ──

  async generateWikiPagesFromDocument(input: {
    userId: string;
    documentId: string;
    title: string;
    content: string;
  }): Promise<{ pages: any[]; generatedBy: "llm" | "fallback" }> {
    if (!this.wikiGenerator) {
      throw new Error("Wiki store is not initialized");
    }
    return this.wikiGenerator.generateWikiPagesFromDocument(input);
  }

  // ── Swarm config CRUD ──

  async addSwarmConfig(config: SwarmConfig, userId: string): Promise<SwarmConfig> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    this.validateSwarmConfig(config);
    const existing = await this.storage.loadSwarm(config.id, normalizedUserId);
    if (existing) throw new Error(`Swarm already exists: ${config.id}`);

    await this.storage.saveSwarm(config, normalizedUserId);
    this.swarmConfigs.set(config.id, config);
    this.logger.info("swarm_created", { swarmId: config.id, name: config.name, mode: config.mode });
    return config;
  }

  async updateSwarmConfig(id: string, config: SwarmConfig, userId: string): Promise<SwarmConfig> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadSwarm(id, normalizedUserId);
    if (!existing) throw new Error(`Swarm not found: ${id}`);
    this.validateSwarmConfig(config);

    await this.storage.saveSwarm(config, normalizedUserId);
    this.swarmConfigs.set(id, config);
    return config;
  }

  async deleteSwarmConfig(id: string, userId: string): Promise<void> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const config = await this.storage.loadSwarm(id, normalizedUserId);
    if (!config) throw new Error(`Swarm not found: ${id}`);

    await this.storage.deleteSwarm(id, normalizedUserId);
    this.swarmConfigs.delete(id);
    this.logger.info("swarm_deleted", { swarmId: id, name: config.name });
  }

  async getSwarmConfig(swarmId: string, userId: string): Promise<SwarmConfig | undefined> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    const config = await this.storage.loadSwarm(swarmId, normalizedUserId);
    return config ?? undefined;
  }

  async listSwarms(userId: string): Promise<SwarmConfig[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    return this.storage.listSwarms(normalizedUserId);
  }

  // ── Workspace CRUD ──

  async createWorkspace(userId: string, input: { name: string; description?: string }) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.createWorkspace(normalizedUserId, input);
  }

  async getWorkspace(workspaceId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.getWorkspace(workspaceId, normalizedUserId);
  }

  async listWorkspaces(userId: string, options?: { includeArchived?: boolean }) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.listWorkspaces(normalizedUserId, options);
  }

  async updateWorkspace(workspaceId: string, userId: string, patch: { name?: string; description?: string }) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.updateWorkspace(workspaceId, normalizedUserId, patch);
  }

  async archiveWorkspace(workspaceId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.archiveWorkspace(workspaceId, normalizedUserId);
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const workspace = await this.storage.getWorkspace(workspaceId, normalizedUserId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    await createWorkspaceManager(workspaceId).cleanup();
    await this.storage.deleteWorkspace(workspaceId, normalizedUserId);
  }

  // ── Usage ──

  async getConversationUsage(conversationId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.getConversationUsage(conversationId, normalizedUserId);
  }

  async getDailyUsage(userId: string, days?: number) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.getDailyUsage(normalizedUserId, days);
  }

  async logLLMCall(call: LLMCallRecord): Promise<void> {
    this.ensureInitialized();
    await this.storage.logLLMCall(call);
  }

  async queryLLMCalls(filter: LLMCallQuery, userId: string): Promise<LLMCallRecord[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.queryLLMCalls(filter, normalizedUserId);
  }

  // ── Agent preset management ──

  async listAgentPresets(userId: string): Promise<AgentPreset[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    return this.storage.listAgentPresets(normalizedUserId);
  }

  async getAgentPreset(id: string, userId: string): Promise<AgentPreset | null> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    return this.storage.loadAgentPreset(id, normalizedUserId);
  }

  async addAgentPreset(preset: AgentPreset, userId: string): Promise<AgentPreset> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    if (!preset.id || !preset.name) throw new Error("Agent preset id and name are required");
    const existing = await this.storage.loadAgentPreset(preset.id, normalizedUserId);
    if (existing) throw new Error(`Agent preset already exists: ${preset.id}`);
    await this.storage.saveAgentPreset(preset, normalizedUserId);
    return preset;
  }

  async updateAgentPreset(id: string, preset: AgentPreset, userId: string): Promise<AgentPreset> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadAgentPreset(id, normalizedUserId);
    if (!existing) throw new Error(`Agent preset not found: ${id}`);
    await this.storage.saveAgentPreset(preset, normalizedUserId);
    return preset;
  }

  async deleteAgentPreset(id: string, userId: string): Promise<void> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadAgentPreset(id, normalizedUserId);
    if (!existing) throw new Error(`Agent preset not found: ${id}`);
    if (existing.builtIn) throw new Error(`Built-in agent preset is read-only: ${id}`);
    await this.storage.deleteAgentPreset(id, normalizedUserId);
  }

  // ── Agent template management ──

  async listAgentTemplates(): Promise<AgentPreset[]> {
    this.ensureInitialized();
    await this.ensureTemplatesSeeded();
    return this.storage.listAgentTemplates();
  }

  async addAgentTemplate(preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    if (!preset.id || !preset.name) throw new Error("Agent template id and name are required");
    await this.storage.saveAgentTemplate(preset);
    return preset;
  }

  async updateAgentTemplate(id: string, preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentTemplate(id);
    if (!existing) throw new Error(`Agent template not found: ${id}`);
    await this.storage.saveAgentTemplate(preset);
    return preset;
  }

  async deleteAgentTemplate(id: string): Promise<void> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentTemplate(id);
    if (!existing) throw new Error(`Agent template not found: ${id}`);
    await this.storage.deleteAgentTemplate(id);
  }

  // ── User management ──

  async createUser(user: StoredUser): Promise<void> {
    this.ensureInitialized();
    await this.storage.createUser(user);
  }

  async countUsers(): Promise<number> {
    this.ensureInitialized();
    return this.storage.countUsers();
  }

  async getUserByUsername(username: string): Promise<StoredUser | null> {
    this.ensureInitialized();
    return this.storage.getUserByUsername(username);
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    this.ensureInitialized();
    return this.storage.getUserById(id);
  }

  async close(): Promise<void> {
    if (this.storage) {
      await this.storage.close();
    }
    this.seededUserIds.clear();
    this._initialized = false;
  }

  // ── Private helpers ──

  private createConversationInstance(
    conversationId: string,
    userId: string,
    swarmConfig: SwarmConfig,
    restoredMessages: StoredMessage[],
    workspaceId?: string | null,
  ): Conversation {
    return new Conversation(
      conversationId,
      userId,
      swarmConfig,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      restoredMessages,
      this.eventLogLevel,
      (context) => this.createToolRuntimeAvailability(context),
      workspaceId ?? undefined,
    );
  }

  private async validateWorkspace(workspaceId: string | undefined | null, userId: string): Promise<void> {
    if (!workspaceId) return;
    const workspace = await this.storage.getWorkspace(workspaceId, userId);
    if (!workspace || workspace.archivedAt) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
  }

  private normalizeUserId(userId: string): string {
    const normalized = userId.trim();
    if (!normalized) throw new Error("userId is required");
    return normalized;
  }

  private getDirectSwarmId(userId: string): string {
    return `${AgentSwarm.DIRECT_SWARM_ID}_${userId}`;
  }

  private async ensureUserSeedData(userId: string): Promise<void> {
    if (this.seededUserIds.has(userId)) return;

    const swarms = await this.storage.listSwarms(userId);
    if (swarms.length === 0 && this.config.swarms.length > 0) {
      for (const swarm of this.config.swarms) {
        try {
          this.validateSwarmConfig(swarm);
          await this.storage.saveSwarm(swarm, userId);
        } catch {
          // ignore invalid bootstrap swarm config
        }
      }
    }

    this.seededUserIds.add(userId);
  }

  private async ensureTemplatesSeeded(): Promise<void> {
    if (this.templatesSeeded) return;
    const templates = await this.storage.listAgentTemplates();
    if (templates.length === 0) {
      for (const preset of PRESET_AGENTS) {
        await this.storage.saveAgentTemplate(preset);
      }
    }
    this.templatesSeeded = true;
  }

  private ensureInitialized() {
    if (!this._initialized) throw new Error("AgentSwarm not initialized. Call init() first.");
  }

  private cloneLLMConfig(config: LLMBackendConfig): LLMBackendConfig {
    return JSON.parse(JSON.stringify(config)) as LLMBackendConfig;
  }

  private loadConfigFromPath(configPath: string): AgentSwarmRootConfig {
    const absPath = resolvePath(configPath);
    if (!absPath.endsWith(".json")) throw new Error("configPath currently supports JSON files only.");
    const raw = readFileSync(absPath, "utf-8");
    return JSON.parse(raw) as AgentSwarmRootConfig;
  }

  private normalizeEventLogLevel(level: AgentSwarmRootConfig["eventLogLevel"]): EventLogLevel {
    return level === "none" || level === "key" || level === "full" ? level : "key";
  }

  private validateSwarmConfig(config: SwarmConfig): void {
    if (!config.agents.length) throw new Error(`Invalid swarm "${config.id}": at least one agent is required`);
    if (config.mode === "router" && !config.orchestrator) throw new Error(`Invalid router swarm "${config.id}": orchestrator is required`);
    if (config.mode === "debate" && !config.debateConfig) {
      const agents = config.agents;
      config.debateConfig = {
        rounds: 3,
        proAgent: agents[0]?.id ?? "",
        conAgent: agents[1]?.id ?? agents[0]?.id ?? "",
        judgeAgent: agents[0]?.id ?? "",
      };
    }
  }

  private applyConversationDirectModel(
    swarmConfig: SwarmConfig,
    conversation: StoredConversation,
  ): SwarmConfig {
    if (!swarmConfig.id.startsWith("__direct_")) return swarmConfig;

    const directModel = conversation.directModel;
    if (!directModel || !swarmConfig.agents[0]) return swarmConfig;

    const [firstAgent, ...restAgents] = swarmConfig.agents;
    return {
      ...swarmConfig,
      name: `${directModel.provider}/${directModel.modelId}`,
      agents: [
        {
          ...firstAgent,
          name: `${directModel.provider}/${directModel.modelId}`,
          description: `Direct chat with ${directModel.provider}/${directModel.modelId}`,
          model: { ...firstAgent.model, provider: directModel.provider, modelId: directModel.modelId },
        },
        ...restAgents,
      ],
    };
  }
}
