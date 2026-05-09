import type { SwarmConfig, AgentSwarmRootConfig, LLMBackendConfig, ApiProtocol, EventLogLevel, AgentPreset } from "./types.js";
import type { IStorage, LLMCallRecord, LLMCallQuery, StoredUser, PublicUser, StoredEvent } from "../storage/interface.js";
import type { Conversation as StoredConversation, ConversationPreferences } from "../storage/interface.js";
import type { StoredMessage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { Conversation } from "./conversation.js";
import { PRESET_AGENTS } from "./presets.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { complete, getProviders as piGetProviders, getModels as piGetModels } from "@mariozechner/pi-ai";
import type { Model as PiModel, KnownProvider } from "@mariozechner/pi-ai";
import { resolveModelFromProvider } from "../llm/provider.js";
import type { Logger } from "../logger/types.js";
import { ConsoleLogger } from "../logger/console-logger.js";
import type { WebSearchConfig } from "../tools/web-search.js";
import type { WebFetchConfig } from "../tools/web-fetch.js";
import { MCPClient } from "../tools/mcp/client.js";
import type { MCPServerConfig } from "../tools/mcp/client.js";
import type { IVectorStore } from "../storage/vector-store.js";
import type { IWikiStore, WikiClaim, WikiLink, WikiPage, WikiPageDetail, WikiPageInput } from "../storage/wiki-store.js";
import type { ToolRuntimeAvailability } from "../tools/runtime.js";
import { createRuntimeTool } from "../tools/runtime.js";
import { createAllMCPTools } from "../tools/mcp/tool-provider.js";
import { createRetrieveKnowledgeTool } from "../tools/retrieve-knowledge.js";
import { createSearchWikiTool } from "../tools/search-wiki.js";
import { createWorkspaceManager } from "../tools/workspace/manager.js";
import { createWorkspaceTool } from "../tools/workspace/tool-set.js";

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

export interface ModelConnectionTestOptions {
  provider: string;
  modelId: string;
  prompt?: string;
  timeoutMs?: number;
  override?: {
    apiKey?: string;
    baseUrl?: string;
    apiProtocol?: ApiProtocol;
    thinkingFormat?: string;
  };
}

export interface ModelConnectionTestResult {
  ok: boolean;
  provider: string;
  modelId: string;
  text: string;
  stopReason?: string;
  error?: string;
  durationMs: number;
}

export interface ProviderInfo {
  id: string;
  /** Whether this is a built-in pi-ai provider */
  builtIn: boolean;
  /** Default API protocol for this provider */
  defaultApiProtocol?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
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

  private normalizeUserId(userId: string): string {
    const normalized = userId.trim();
    if (!normalized) {
      throw new Error("userId is required");
    }
    return normalized;
  }

  private getDirectSwarmId(userId: string): string {
    return `${AgentSwarm.DIRECT_SWARM_ID}_${userId}`;
  }

  private async ensureUserSeedData(userId: string): Promise<void> {
    if (this.seededUserIds.has(userId)) {
      return;
    }

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

  /**
   * Create a new conversation for a swarm.
   */
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

    if (workspaceId) {
      const workspace = await this.storage.getWorkspace(workspaceId, normalizedUserId);
      if (!workspace || workspace.archivedAt) {
        throw new Error(`Workspace not found: ${workspaceId}`);
      }
    }

    const conv = await this.storage.createConversation(swarmId, normalizedUserId, title, preferences, workspaceId);

    return new Conversation(
      conv.id,
      normalizedUserId,
      swarmConfig,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      [],
      this.eventLogLevel,
      (context) => this.createToolRuntimeAvailability(context),
      conv.workspaceId,
    );
  }

  /**
   * Fork an existing conversation — replicate its message history into a new
   * conversation, optionally bound to a different swarm config.
   */
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
      if (messageIndex < 0) {
        throw new Error(`Message not found: ${options.messageId}`);
      }
      messagesToCopy = sourceMessages.slice(0, messageIndex + 1);
    }

    const newConv = await this.storage.createConversation(
      swarmId,
      normalizedUserId,
      options.title ?? `${source.title ?? "对话"} (分支)`,
      {
        enabledTools: source.enabledTools,
        thinkingLevel: source.thinkingLevel,
        directModel: source.directModel,
      },
      source.workspaceId,
    );

    // Replicate messages with new IDs
    for (const msg of messagesToCopy) {
      await this.storage.appendMessage(newConv.id, {
        ...msg,
        id: crypto.randomUUID(),
      });
    }

    // Preserve context reset boundary only when it still applies to copied history.
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

    return new Conversation(
      newConv.id,
      normalizedUserId,
      swarmConfig,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      [],
      this.eventLogLevel,
      (context) => this.createToolRuntimeAvailability(context),
      newConv.workspaceId,
    );
  }

  /**
   * Create a direct (single-model) conversation without a pre-configured swarm.
   * Internally creates a virtual SwarmConfig with one agent for the given model.
   */
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

    // Create a virtual swarm config for direct chat
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

    // Register the virtual swarm temporarily
    this.swarmConfigs.set(swarmId, directSwarm);

    // Persist virtual swarm so conversations.swarm_id FK is always valid.
    try {
      await this.storage.saveSwarm(directSwarm, normalizedUserId);
    } catch {
      // If saveSwarm fails (e.g. transient DB issue), keep in-memory config available.
    }

    if (workspaceId) {
      const workspace = await this.storage.getWorkspace(workspaceId, normalizedUserId);
      if (!workspace || workspace.archivedAt) {
        throw new Error(`Workspace not found: ${workspaceId}`);
      }
    }

    const conv = await this.storage.createConversation(swarmId, normalizedUserId, title, {
      ...preferences,
      directModel: { provider, modelId },
    }, workspaceId);

    return new Conversation(
      conv.id,
      normalizedUserId,
      directSwarm,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      [],
      this.eventLogLevel,
      (context) => this.createToolRuntimeAvailability(context),
      conv.workspaceId,
    );
  }

  /**
   * Resume an existing conversation.
   */
  async resumeConversation(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);

    const conv = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const swarmConfig = await this.storage.loadSwarm(conv.swarmId, normalizedUserId);
    if (!swarmConfig) {
      throw new Error(`Swarm not found: ${conv.swarmId}`);
    }

    const storedMessages = await this.storage.getMessages(conversationId);
    const contextResetAt = conv.contextResetAt;
    const restoredMessages = typeof contextResetAt === "number"
      // Use storage creation time instead of logical message timestamp.
      // Message timestamps may come from model/user payloads and are not guaranteed monotonic.
      ? storedMessages.filter((message) => (message.createdAt ?? message.timestamp) > contextResetAt)
      : storedMessages;

    const conversation = new Conversation(
      conv.id,
      normalizedUserId,
      this.applyConversationDirectModel(swarmConfig, conv),
      this.storage,
      this.config.llm,
      this.interventionHandler,
      restoredMessages,
      this.eventLogLevel,
      (context) => this.createToolRuntimeAvailability(context),
      conv.workspaceId,
    );

    return conversation;
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

  /**
   * Clear runtime model context for a conversation without deleting persisted messages.
   * Future runs will only restore messages created after this reset point.
   */
  async clearConversationContext(
    conversationId: string,
    userId: string,
  ): Promise<ConversationContextClearResult> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);

    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const contextResetAt = Date.now();
    await this.storage.updateConversationContextReset(conversationId, contextResetAt, normalizedUserId);

    const markerMessage: StoredMessage = {
      id: crypto.randomUUID(),
      agentId: null,
      role: "notification",
      content: "已清空上下文，后续回复仅基于新消息。",
      metadata: JSON.stringify({
        type: "context_cleared",
        contextResetAt,
      }),
      timestamp: contextResetAt,
      createdAt: contextResetAt,
    };
    await this.storage.appendMessage(conversationId, markerMessage);

    return {
      conversationId,
      contextResetAt,
      markerMessage,
    };
  }

  /**
   * List conversations for a swarm.
   */
  async listConversations(swarmId: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    return this.storage.listConversations(swarmId, normalizedUserId);
  }

  /**
   * List all conversations across all swarms.
   */
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
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    await createWorkspaceManager(workspaceId).cleanup();
    await this.storage.deleteWorkspace(workspaceId, normalizedUserId);
  }

  /**
   * Delete a conversation.
   */
  async deleteConversation(id: string, userId: string) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(id, normalizedUserId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
    }

    await this.storage.deleteConversation(id, normalizedUserId);
  }

  /**
   * Get messages for a conversation.
   */
  async getMessages(conversationId: string, userId: string, since?: number) {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return this.storage.getMessages(conversationId, since);
  }

  async getConversationEvents(conversationId: string, userId: string, eventType?: string): Promise<StoredEvent[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const conversation = await this.storage.getConversation(conversationId, normalizedUserId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return this.storage.getEvents(conversationId, eventType);
  }

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

  async getSwarmConfig(
    swarmId: string,
    userId: string,
  ): Promise<SwarmConfig | undefined> {
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

  /**
   * List all available providers (built-in pi-ai providers + user-configured providers).
   */
  listProviders(): ProviderInfo[] {
    const builtInProviders = piGetProviders() as KnownProvider[];
    const builtInSet = new Set<string>(builtInProviders);

    const result: ProviderInfo[] = builtInProviders.map((id) => ({
      id,
      builtIn: true,
      defaultApiProtocol: this.getDefaultApiProtocol(id),
    }));

    // Add user-configured providers that are not built-in
    const configuredProviders = new Set<string>([
      ...Object.keys(this.config.llm.apiKeys ?? {}),
      ...Object.keys(this.config.llm.providers ?? {}),
    ]);

    for (const id of configuredProviders) {
      if (!builtInSet.has(id)) {
        result.push({
          id,
          builtIn: false,
          defaultApiProtocol: this.getDefaultApiProtocol(id),
        });
      }
    }

    return result;
  }

  /**
   * List all available models for a given provider.
   * Priority: 1. Online API fetch → 2. pi-ai built-in catalog → 3. User-saved models
   */
  async listModels(providerId: string): Promise<ModelInfo[]> {
    // 1. Try online model listing via OpenAI-compatible /v1/models endpoint
    const onlineModels = await this.fetchOnlineModels(providerId);
    if (onlineModels.length > 0) {
      return onlineModels;
    }

    // 2. Built-in pi-ai providers: return static catalog
    const builtInProviders = piGetProviders() as KnownProvider[];
    if ((builtInProviders as string[]).includes(providerId)) {
      try {
        const piModels = piGetModels(providerId as KnownProvider) as PiModel<any>[];
        return piModels.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          api: m.api,
          reasoning: m.reasoning,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
        }));
      } catch {
        // Fall through to saved models
      }
    }

    // 3. Fallback: user-saved models
    const savedModels = this.config.llm.models ?? [];
    return savedModels
      .filter((m) => m.provider === providerId)
      .map((m) => ({
        id: m.modelId,
        name: m.name,
        provider: m.provider,
        api: this.getDefaultApiProtocol(providerId) ?? "openai-completions",
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 4096,
      }));
  }

  /**
   * Fetch model list from provider's online API.
   * Supports OpenAI-compatible /v1/models and Anthropic /v1/models endpoints.
   */
  private async fetchOnlineModels(providerId: string): Promise<ModelInfo[]> {
    const apiKey = this.config.llm.apiKeys?.[providerId];
    const providerConfig = this.config.llm.providers?.[providerId];
    const baseUrl = providerConfig?.baseUrl;

    // Provider-specific base URLs for known providers
    const KNOWN_BASE_URLS: Record<string, string> = {
      openai: "https://api.openai.com",
      anthropic: "https://api.anthropic.com",
      groq: "https://api.groq.com",
      cerebras: "https://api.cerebras.ai",
      openrouter: "https://openrouter.ai/api",
      xai: "https://api.x.ai",
      mistral: "https://api.mistral.ai",
      deepseek: "https://api.deepseek.com",
      siliconflow: "https://api.siliconflow.cn",
      zai: "https://api.z.ai",
    };

    const effectiveBaseUrl = baseUrl ?? KNOWN_BASE_URLS[providerId];
    if (!effectiveBaseUrl || !apiKey) return [];

    try {
      // baseUrl may already include /v1 (e.g. http://localhost:8317/v1)
      // or may not (e.g. https://api.openai.com). Handle both cases.
      const base = effectiveBaseUrl.replace(/\/+$/, "");
      const modelsUrl = base.endsWith("/v1")
        ? `${base}/models`
        : `${base}/v1/models`;
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      // Anthropic uses x-api-key instead of Bearer
      if (providerId === "anthropic") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        delete headers["Authorization"];
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(modelsUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const body = await response.json() as any;

      // OpenAI-compatible response: { data: [{ id, object, ... }] }
      const rawModels: any[] = body?.data ?? body?.models ?? [];
      if (!Array.isArray(rawModels)) return [];

      const apiProtocol = this.getDefaultApiProtocol(providerId) ?? "openai-completions";

      return rawModels
        .filter((m: any) => typeof m.id === "string")
        .map((m: any) => ({
          id: m.id,
          name: m.name ?? m.id,
          provider: providerId,
          api: apiProtocol,
          reasoning: false,
          contextWindow: m.context_window ?? m.contextWindow ?? 128000,
          maxTokens: m.max_output_tokens ?? m.maxTokens ?? 4096,
        }))
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  private getDefaultApiProtocol(providerId: string): string | undefined {
    const providerConfig = this.config.llm.providers?.[providerId];
    if (providerConfig?.apiProtocol) return providerConfig.apiProtocol;

    // Check DEFAULT_PROTOCOL_MAP from provider.ts — inline the mapping here
    const PROTOCOL_MAP: Record<string, string> = {
      anthropic: "anthropic-messages",
      openai: "openai-completions",
      google: "google-generative-ai",
      xai: "openai-completions",
      groq: "openai-completions",
      cerebras: "openai-completions",
      openrouter: "openai-completions",
      mistral: "mistral-conversations",
      deepseek: "openai-completions",
      siliconflow: "openai-completions",
      zai: "openai-completions",
    };
    return PROTOCOL_MAP[providerId];
  }

  /**
   * Add a new swarm config at runtime.
   */
  async addSwarmConfig(
    config: SwarmConfig,
    userId: string,
  ): Promise<SwarmConfig> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    this.validateSwarmConfig(config);
    const existing = await this.storage.loadSwarm(config.id, normalizedUserId);
    if (existing) {
      throw new Error(`Swarm already exists: ${config.id}`);
    }

    await this.storage.saveSwarm(config, normalizedUserId);
    this.swarmConfigs.set(config.id, config);
    this.logger.info("swarm_created", { swarmId: config.id, name: config.name, mode: config.mode });
    return config;
  }

  /**
   * Update an existing swarm config.
   */
  async updateSwarmConfig(
    id: string,
    config: SwarmConfig,
    userId: string,
  ): Promise<SwarmConfig> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadSwarm(id, normalizedUserId);
    if (!existing) {
      throw new Error(`Swarm not found: ${id}`);
    }
    this.validateSwarmConfig(config);

    await this.storage.saveSwarm(config, normalizedUserId);
    this.swarmConfigs.set(id, config);
    return config;
  }

  /**
   * Delete a swarm config.
   */
  async deleteSwarmConfig(
    id: string,
    userId: string,
  ): Promise<void> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const config = await this.storage.loadSwarm(id, normalizedUserId);
    if (!config) {
      throw new Error(`Swarm not found: ${id}`);
    }

    await this.storage.deleteSwarm(id, normalizedUserId);
    this.swarmConfigs.delete(id);
    this.logger.info("swarm_deleted", { swarmId: id, name: config.name });
  }

  getLLMConfig(): LLMBackendConfig {
    return this.cloneLLMConfig(this.config.llm);
  }

  async updateLLMConfig(nextConfig: LLMBackendConfig): Promise<LLMBackendConfig> {
    this.ensureInitialized();
    this.config.llm = this.cloneLLMConfig(nextConfig);
    await this.storage.saveSetting(
      AgentSwarm.LLM_CONFIG_KEY,
      JSON.stringify(this.config.llm),
    );
    this.logger.info("llm_config_updated", { providers: Object.keys(nextConfig.apiKeys) });
    return this.cloneLLMConfig(this.config.llm);
  }

  async generateWikiPagesFromDocument(input: {
    userId: string;
    documentId: string;
    title: string;
    content: string;
  }): Promise<{ pages: WikiPageDetail[]; generatedBy: "llm" | "fallback" }> {
    this.ensureInitialized();
    if (!this.wikiStore) {
      throw new Error("Wiki store is not initialized");
    }

    const normalizedUserId = this.normalizeUserId(input.userId);
    const text = input.content.trim();
    if (!text) {
      throw new Error("document content is required");
    }

    const drafts = await this.generateWikiDrafts(input.title, text, input.documentId);
    const pages: WikiPageDetail[] = [];
    const existingPages = await this.wikiStore.listPages(normalizedUserId);
    for (const draft of drafts.pages) {
      const matched = await this.findMatchingWikiPage(normalizedUserId, draft, existingPages);
      if (matched) {
        const updated = await this.wikiStore.updatePage(
          matched.id,
          normalizedUserId,
          mergeWikiPage(matched, draft, input.documentId),
        );
        pages.push(updated);
        const index = existingPages.findIndex((page) => page.id === updated.id);
        if (index >= 0) {
          existingPages[index] = updated;
        }
        continue;
      }

      const created = await this.wikiStore.createPage(normalizedUserId, draft);
      pages.push(created);
      existingPages.push(created);
    }
    return {
      pages,
      generatedBy: drafts.generatedBy,
    };
  }

  private async findMatchingWikiPage(
    userId: string,
    draft: WikiPageInput,
    existingPages: WikiPage[],
  ): Promise<WikiPageDetail | null> {
    const draftKeys = new Set([
      normalizeWikiKey(draft.title),
      ...(draft.aliases ?? []).map(normalizeWikiKey),
    ].filter(Boolean));

    const matched = existingPages.find((page) => {
      const pageKeys = [
        normalizeWikiKey(page.title),
        ...page.aliases.map(normalizeWikiKey),
      ].filter(Boolean);
      return pageKeys.some((key) => draftKeys.has(key));
    });

    if (!matched) {
      return null;
    }
    if (!this.wikiStore) {
      return null;
    }
    return this.wikiStore.getPage(matched.id, userId);
  }

  private async generateWikiDrafts(
    title: string,
    content: string,
    documentId: string,
  ): Promise<{ pages: WikiPageInput[]; generatedBy: "llm" | "fallback" }> {
    const savedModel = this.config.llm.models?.[0];
    if (!savedModel) {
      return { pages: [this.createFallbackWikiPage(title, content, documentId)], generatedBy: "fallback" };
    }

    try {
      const model = resolveModelFromProvider(savedModel.provider, savedModel.modelId, this.config.llm);
      const prompt = [
        "你是一个知识库架构师。请把用户提供的资料整理成 1 到 5 个可维护的 Wiki 页面。",
        "只返回严格 JSON，不要 Markdown，不要代码块。",
        "JSON 格式：",
        "{\"pages\":[{\"title\":\"\",\"summary\":\"\",\"content\":\"\",\"aliases\":[\"\"],\"tags\":[\"\"],\"claims\":[{\"text\":\"\",\"confidence\":0.8}],\"links\":[{\"toTitle\":\"\",\"relation\":\"related\"}]}]}",
        "要求：",
        "- title 是清晰概念名或流程名。",
        "- summary 用 1-2 句话概括。",
        "- content 用中文 Markdown，包含关键规则、流程、注意事项。",
        "- claims 是可追溯事实点，必须来自原文。",
        "- links.relation 只能是 related/prerequisite/explains/contradicts/part_of。",
        "- 不要编造原文没有的信息。",
        "",
        `资料标题：${title}`,
        "资料正文：",
        content.slice(0, 24_000),
      ].join("\n");

      const message = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: this.config.llm.apiKeys?.[savedModel.provider] ?? "",
          maxTokens: 4096,
          temperature: 0.2,
        },
      );

      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      const pages = parseWikiDrafts(text, documentId);
      if (pages.length > 0) {
        return { pages, generatedBy: "llm" };
      }
    } catch (error) {
      this.logger.warn("wiki_generation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { pages: [this.createFallbackWikiPage(title, content, documentId)], generatedBy: "fallback" };
  }

  private createFallbackWikiPage(title: string, content: string, documentId: string): WikiPageInput {
    const normalizedTitle = title.trim() || "未命名资料";
    const paragraphs = content.split(/\n\n+/).map((item) => item.trim()).filter(Boolean);
    const summary = paragraphs[0]?.slice(0, 220) || content.slice(0, 220);
    return {
      title: normalizedTitle,
      summary,
      content: content.slice(0, 8000),
      aliases: [],
      tags: [],
      status: "active",
      sourceDocumentIds: [documentId],
      claims: paragraphs.slice(0, 8).map((paragraph) => ({
        text: paragraph.slice(0, 280),
        sourceDocumentId: documentId,
        confidence: 0.5,
      })),
      links: [],
    };
  }

  // ── Agent preset management ──

  async listAgentPresets(userId: string): Promise<AgentPreset[]> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    return this.storage.listAgentPresets(normalizedUserId);
  }

  async getAgentPreset(
    id: string,
    userId: string,
  ): Promise<AgentPreset | null> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    await this.ensureUserSeedData(normalizedUserId);
    return this.storage.loadAgentPreset(id, normalizedUserId);
  }

  async addAgentPreset(
    preset: AgentPreset,
    userId: string,
  ): Promise<AgentPreset> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    if (!preset.id || !preset.name) {
      throw new Error("Agent preset id and name are required");
    }
    const existing = await this.storage.loadAgentPreset(preset.id, normalizedUserId);
    if (existing) {
      throw new Error(`Agent preset already exists: ${preset.id}`);
    }
    await this.storage.saveAgentPreset(preset, normalizedUserId);
    return preset;
  }

  async updateAgentPreset(
    id: string,
    preset: AgentPreset,
    userId: string,
  ): Promise<AgentPreset> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadAgentPreset(id, normalizedUserId);
    if (!existing) {
      throw new Error(`Agent preset not found: ${id}`);
    }
    await this.storage.saveAgentPreset(preset, normalizedUserId);
    return preset;
  }

  async deleteAgentPreset(
    id: string,
    userId: string,
  ): Promise<void> {
    this.ensureInitialized();
    const normalizedUserId = this.normalizeUserId(userId);
    const existing = await this.storage.loadAgentPreset(id, normalizedUserId);
    if (!existing) {
      throw new Error(`Agent preset not found: ${id}`);
    }
    if (existing.builtIn) {
      throw new Error(`Built-in agent preset is read-only: ${id}`);
    }
    await this.storage.deleteAgentPreset(id, normalizedUserId);
  }

  // ── Agent template management (system-level, shared across users) ──

  async listAgentTemplates(): Promise<AgentPreset[]> {
    this.ensureInitialized();
    await this.ensureTemplatesSeeded();
    return this.storage.listAgentTemplates();
  }

  async addAgentTemplate(preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    if (!preset.id || !preset.name) {
      throw new Error("Agent template id and name are required");
    }
    await this.storage.saveAgentTemplate(preset);
    return preset;
  }

  async updateAgentTemplate(id: string, preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentTemplate(id);
    if (!existing) {
      throw new Error(`Agent template not found: ${id}`);
    }
    await this.storage.saveAgentTemplate(preset);
    return preset;
  }

  async deleteAgentTemplate(id: string): Promise<void> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentTemplate(id);
    if (!existing) {
      throw new Error(`Agent template not found: ${id}`);
    }
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

  async testModelConnection(options: ModelConnectionTestOptions): Promise<ModelConnectionTestResult> {
    this.ensureInitialized();

    const provider = options.provider?.trim();
    const modelId = options.modelId?.trim();
    if (!provider || !modelId) {
      throw new Error("provider and modelId are required");
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.min(options.timeoutMs!, 120_000)
      : 20_000;
    const prompt = typeof options.prompt === "string" && options.prompt.trim().length > 0
      ? options.prompt.trim()
      : "请只回复：OK";

    const llmConfig = this.cloneLLMConfig(this.config.llm);
    if (options.override?.apiKey !== undefined) {
      llmConfig.apiKeys = {
        ...(llmConfig.apiKeys ?? {}),
        [provider]: options.override.apiKey,
      };
    }
    if (
      options.override?.baseUrl !== undefined
      || options.override?.apiProtocol !== undefined
      || options.override?.thinkingFormat !== undefined
    ) {
      llmConfig.providers = {
        ...(llmConfig.providers ?? {}),
        [provider]: {
          ...(llmConfig.providers?.[provider] ?? {}),
          ...(options.override.baseUrl !== undefined ? { baseUrl: options.override.baseUrl } : {}),
          ...(options.override.apiProtocol !== undefined ? { apiProtocol: options.override.apiProtocol } : {}),
          ...(options.override.thinkingFormat !== undefined ? { thinkingFormat: options.override.thinkingFormat } : {}),
        },
      };
    }

    const model = resolveModelFromProvider(
      provider,
      modelId,
      llmConfig,
      {
        provider,
        modelId,
        apiKey: llmConfig.apiKeys?.[provider] ?? "",
        baseUrl: options.override?.baseUrl,
        apiProtocol: options.override?.apiProtocol,
      },
    );

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const message = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: llmConfig.apiKeys?.[provider] ?? "",
          signal: controller.signal,
          maxTokens: 128,
          temperature: 0,
        },
      );

      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        const rawError = message.errorMessage ?? "Model returned an error stop reason";
        return {
          ok: false,
          provider,
          modelId,
          text,
          stopReason: message.stopReason,
          error: message.stopReason === "aborted"
            ? `请求超时（>${timeoutMs}ms）`
            : rawError,
          durationMs: Date.now() - start,
        };
      }

      return {
        ok: text.length > 0,
        provider,
        modelId,
        text,
        stopReason: message.stopReason,
        durationMs: Date.now() - start,
        ...(text.length === 0 ? { error: "模型返回为空" } : {}),
      };
    } catch (err: any) {
      const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
      return {
        ok: false,
        provider,
        modelId,
        text: "",
        error: raw.includes("aborted")
          ? `请求超时（>${timeoutMs}ms）`
          : raw,
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private ensureInitialized() {
    if (!this._initialized) {
      throw new Error("AgentSwarm not initialized. Call init() first.");
    }
  }

  private cloneLLMConfig(config: LLMBackendConfig): LLMBackendConfig {
    return JSON.parse(JSON.stringify(config)) as LLMBackendConfig;
  }

  private loadConfigFromPath(configPath: string): AgentSwarmRootConfig {
    const absPath = resolvePath(configPath);
    if (!absPath.endsWith(".json")) {
      throw new Error("configPath currently supports JSON files only.");
    }
    const raw = readFileSync(absPath, "utf-8");
    const parsed = JSON.parse(raw) as AgentSwarmRootConfig;
    return parsed;
  }

  private normalizeEventLogLevel(level: AgentSwarmRootConfig["eventLogLevel"]): EventLogLevel {
    if (level === "none" || level === "key" || level === "full") {
      return level;
    }
    return "key";
  }

  private validateSwarmConfig(config: SwarmConfig): void {
    if (!config.agents.length) {
      throw new Error(`Invalid swarm "${config.id}": at least one agent is required`);
    }
    if (config.mode === "router" && !config.orchestrator) {
      throw new Error(`Invalid router swarm "${config.id}": orchestrator is required`);
    }
    if (config.mode === "debate" && !config.debateConfig) {
      // Auto-fill debateConfig with sensible defaults
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
    if (!swarmConfig.id.startsWith("__direct_")) {
      return swarmConfig;
    }

    const directModel = conversation.directModel;
    if (!directModel || !swarmConfig.agents[0]) {
      return swarmConfig;
    }

    const [firstAgent, ...restAgents] = swarmConfig.agents;
    return {
      ...swarmConfig,
      name: `${directModel.provider}/${directModel.modelId}`,
      agents: [
        {
          ...firstAgent,
          name: `${directModel.provider}/${directModel.modelId}`,
          description: `Direct chat with ${directModel.provider}/${directModel.modelId}`,
          model: {
            ...firstAgent.model,
            provider: directModel.provider,
            modelId: directModel.modelId,
          },
        },
        ...restAgents,
      ],
    };
  }
}

function parseWikiDrafts(rawText: string, documentId: string): WikiPageInput[] {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const pages = Array.isArray(root?.pages) ? root.pages : [];
    return pages
      .map((item) => normalizeWikiDraft(item, documentId))
      .filter((item): item is WikiPageInput => item !== null);
  } catch {
    return [];
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return trimmed.slice(start, end + 1);
}

function normalizeWikiDraft(value: unknown, documentId: string): WikiPageInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const title = normalizeString(raw.title);
  const summary = normalizeString(raw.summary);
  const content = normalizeString(raw.content);
  if (!title || !summary || !content) {
    return null;
  }

  const claims = Array.isArray(raw.claims)
    ? raw.claims
      .map((claim) => normalizeWikiClaimDraft(claim, documentId))
      .filter((claim): claim is NonNullable<ReturnType<typeof normalizeWikiClaimDraft>> => claim !== null)
    : [];
  const links = Array.isArray(raw.links)
    ? raw.links
      .map(normalizeWikiLinkDraft)
      .filter((link): link is NonNullable<ReturnType<typeof normalizeWikiLinkDraft>> => link !== null)
    : [];

  return {
    title,
    summary,
    content,
    aliases: normalizeStringArray(raw.aliases),
    tags: normalizeStringArray(raw.tags),
    status: "active",
    sourceDocumentIds: [documentId],
    claims,
    links,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function normalizeWikiClaimDraft(value: unknown, documentId: string): NonNullable<WikiPageInput["claims"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = normalizeString(raw.text);
  if (!text) return null;
  return {
    text,
    sourceDocumentId: documentId,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
  };
}

function normalizeWikiLinkDraft(value: unknown): NonNullable<WikiPageInput["links"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const toTitle = normalizeString(raw.toTitle);
  if (!toTitle) return null;
  const relation = raw.relation === "prerequisite"
    || raw.relation === "explains"
    || raw.relation === "contradicts"
    || raw.relation === "part_of"
    || raw.relation === "related"
    ? raw.relation
    : "related";
  return { toTitle, relation };
}

function mergeWikiPage(existing: WikiPageDetail, draft: WikiPageInput, documentId: string): Partial<WikiPageInput> {
  const mergedContent = existing.content.includes(draft.content)
    ? existing.content
    : [
      existing.content,
      `## 来源补充 ${documentId.slice(0, 8)}`,
      draft.content,
    ].join("\n\n");

  return {
    title: existing.title,
    summary: mergeSummary(existing.summary, draft.summary),
    content: mergedContent,
    aliases: uniqueStrings([...existing.aliases, ...(draft.aliases ?? [])]),
    tags: uniqueStrings([...existing.tags, ...(draft.tags ?? [])]),
    status: "active",
    sourceDocumentIds: uniqueStrings([...existing.sourceDocumentIds, documentId, ...(draft.sourceDocumentIds ?? [])]),
    claims: mergeClaims(existing.claims, draft.claims ?? []),
    links: mergeLinks(existing.links, draft.links ?? []),
  };
}

function mergeSummary(existing: string, incoming: string): string {
  const normalizedIncoming = incoming.trim();
  if (!normalizedIncoming || existing.includes(normalizedIncoming)) {
    return existing;
  }
  if (normalizeWikiKey(existing) === normalizeWikiKey(normalizedIncoming)) {
    return existing;
  }
  return `${existing}\n${normalizedIncoming}`.slice(0, 800);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalizeWikiKey(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function mergeClaims(
  existing: WikiClaim[],
  incoming: NonNullable<WikiPageInput["claims"]>,
): Array<Omit<WikiClaim, "id" | "pageId"> | WikiClaim> {
  const seen = new Set<string>();
  const result: Array<Omit<WikiClaim, "id" | "pageId"> | WikiClaim> = [];
  for (const claim of [...existing, ...incoming]) {
    const key = normalizeWikiKey(claim.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(claim);
  }
  return result;
}

function mergeLinks(
  existing: WikiLink[],
  incoming: NonNullable<WikiPageInput["links"]>,
): Array<(Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }) | WikiLink> {
  const seen = new Set<string>();
  const result: Array<(Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }) | WikiLink> = [];
  for (const link of [...existing, ...incoming]) {
    const key = `${normalizeWikiKey(link.relation)}:${normalizeWikiKey(link.toTitle)}`;
    if (!link.toTitle.trim() || seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

function normalizeWikiKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
