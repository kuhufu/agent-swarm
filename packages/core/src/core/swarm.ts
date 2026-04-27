import type { SwarmConfig, AgentSwarmRootConfig, LLMBackendConfig, ApiProtocol, EventLogLevel, AgentPreset } from "./types.js";
import type { IStorage } from "../storage/interface.js";
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

export interface AgentSwarmOptions {
  configPath?: string;
  config?: AgentSwarmRootConfig;
  storage?: IStorage;
  interventionHandler?: InterventionHandler;
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
  private _initialized = false;

  constructor(options: AgentSwarmOptions) {
    if (!options.config && !options.configPath) {
      throw new Error("Either config or configPath must be provided");
    }

    this.config = options.config ?? this.loadConfigFromPath(options.configPath!);
    this.eventLogLevel = this.normalizeEventLogLevel(this.config.eventLogLevel);
    this.config.eventLogLevel = this.eventLogLevel;
    this.storage = options.storage ?? new SqliteStorage(this.config.storage.path);
    this.interventionHandler = options.interventionHandler;

    // Bootstrap in-memory index from startup config before init.
    for (const swarm of this.config.swarms) {
      this.swarmConfigs.set(swarm.id, swarm);
    }
  }

  async init(): Promise<void> {
    if (this._initialized) return;

    await this.storage.init();

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

    // DB is source of truth. If DB is empty, seed it from bootstrap config once.
    const existingSwarms = await this.storage.listSwarms();
    if (existingSwarms.length === 0 && this.config.swarms.length > 0) {
      for (const swarm of this.config.swarms) {
        await this.storage.saveSwarm(swarm);
      }
    }

    // Seed built-in agent presets
    const existingPresets = await this.storage.listAgentPresets();
    if (existingPresets.length === 0) {
      for (const preset of PRESET_AGENTS) {
        await this.storage.saveAgentPreset(preset);
      }
    }

    const persistedSwarms = await this.storage.listSwarms();
    const invalidSwarmIds: string[] = [];
    for (const swarm of persistedSwarms) {
      try {
        this.validateSwarmConfig(swarm);
      } catch {
        invalidSwarmIds.push(swarm.id);
      }
    }
    for (const invalidSwarmId of invalidSwarmIds) {
      await this.storage.deleteSwarm(invalidSwarmId);
    }

    const validPersistedSwarms = invalidSwarmIds.length > 0
      ? await this.storage.listSwarms()
      : persistedSwarms;
    this.swarmConfigs.clear();
    for (const swarm of validPersistedSwarms) {
      this.swarmConfigs.set(swarm.id, swarm);
    }
    this.config.swarms = [...validPersistedSwarms];

    this._initialized = true;
  }

  /**
   * Create a new conversation for a swarm.
   */
  async createConversation(
    swarmId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation> {
    this.ensureInitialized();
    const swarmConfig = this.swarmConfigs.get(swarmId);
    if (!swarmConfig) {
      throw new Error(`Swarm not found: ${swarmId}`);
    }

    const conv = await this.storage.createConversation(swarmId, title, preferences);

    return new Conversation(
      conv.id,
      swarmConfig,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      [],
      this.eventLogLevel,
    );
  }

  /**
   * Create a direct (single-model) conversation without a pre-configured swarm.
   * Internally creates a virtual SwarmConfig with one agent for the given model.
   */
  async createDirectConversation(
    provider: string,
    modelId: string,
    title?: string,
    preferences?: Partial<ConversationPreferences>,
  ): Promise<Conversation> {
    this.ensureInitialized();

    const swarmId = AgentSwarm.DIRECT_SWARM_ID;
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
      await this.storage.saveSwarm(directSwarm);
    } catch {
      // If saveSwarm fails (e.g. transient DB issue), keep in-memory config available.
    }

    const conv = await this.storage.createConversation(swarmId, title, {
      ...preferences,
      directModel: { provider, modelId },
    });

    return new Conversation(
      conv.id,
      directSwarm,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      [],
      this.eventLogLevel,
    );
  }

  /**
   * Resume an existing conversation.
   */
  async resumeConversation(conversationId: string): Promise<Conversation> {
    this.ensureInitialized();

    const conv = await this.storage.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const swarmConfig = this.swarmConfigs.get(conv.swarmId);
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
      this.applyConversationDirectModel(swarmConfig, conv),
      this.storage,
      this.config.llm,
      this.interventionHandler,
      restoredMessages,
      this.eventLogLevel,
    );

    return conversation;
  }

  /**
   * Clear runtime model context for a conversation without deleting persisted messages.
   * Future runs will only restore messages created after this reset point.
   */
  async clearConversationContext(conversationId: string): Promise<ConversationContextClearResult> {
    this.ensureInitialized();

    const conversation = await this.storage.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const contextResetAt = Date.now();
    await this.storage.updateConversationContextReset(conversationId, contextResetAt);

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
  async listConversations(swarmId: string) {
    this.ensureInitialized();
    return this.storage.listConversations(swarmId);
  }

  /**
   * List all conversations across all swarms.
   */
  async listAllConversations() {
    this.ensureInitialized();
    return this.storage.listAllConversations();
  }

  async getConversation(conversationId: string) {
    this.ensureInitialized();
    return this.storage.getConversation(conversationId);
  }

  async updateConversationPreferences(
    conversationId: string,
    preferences: Partial<ConversationPreferences>,
  ) {
    this.ensureInitialized();
    return this.storage.updateConversationPreferences(conversationId, preferences);
  }

  /**
   * Delete a conversation.
   */
  async deleteConversation(id: string) {
    this.ensureInitialized();
    await this.storage.deleteConversation(id);
  }

  /**
   * Get messages for a conversation.
   */
  async getMessages(conversationId: string) {
    this.ensureInitialized();
    return this.storage.getMessages(conversationId);
  }

  getSwarmConfig(swarmId: string): SwarmConfig | undefined {
    return this.swarmConfigs.get(swarmId);
  }

  listSwarms(): SwarmConfig[] {
    return Array.from(this.swarmConfigs.values());
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
      zai: "openai-completions",
    };
    return PROTOCOL_MAP[providerId];
  }

  /**
   * Add a new swarm config at runtime.
   */
  async addSwarmConfig(config: SwarmConfig): Promise<SwarmConfig> {
    this.ensureInitialized();
    this.validateSwarmConfig(config);
    if (this.swarmConfigs.has(config.id)) {
      throw new Error(`Swarm already exists: ${config.id}`);
    }

    await this.storage.saveSwarm(config);
    this.swarmConfigs.set(config.id, config);
    this.config.swarms.push(config);
    return config;
  }

  /**
   * Update an existing swarm config.
   */
  async updateSwarmConfig(id: string, config: SwarmConfig): Promise<SwarmConfig> {
    this.ensureInitialized();
    if (!this.swarmConfigs.has(id)) {
      throw new Error(`Swarm not found: ${id}`);
    }
    this.validateSwarmConfig(config);

    await this.storage.saveSwarm(config);
    this.swarmConfigs.set(id, config);
    const index = this.config.swarms.findIndex((s) => s.id === id);
    if (index >= 0) {
      this.config.swarms[index] = config;
    }
    return config;
  }

  /**
   * Delete a swarm config.
   */
  async deleteSwarmConfig(id: string): Promise<void> {
    this.ensureInitialized();
    if (!this.swarmConfigs.has(id)) {
      throw new Error(`Swarm not found: ${id}`);
    }

    await this.storage.deleteSwarm(id);
    this.swarmConfigs.delete(id);
    this.config.swarms = this.config.swarms.filter((s) => s.id !== id);
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
    return this.cloneLLMConfig(this.config.llm);
  }

  // ── Agent preset management ──

  async listAgentPresets(): Promise<AgentPreset[]> {
    this.ensureInitialized();
    return this.storage.listAgentPresets();
  }

  async getAgentPreset(id: string): Promise<AgentPreset | null> {
    this.ensureInitialized();
    return this.storage.loadAgentPreset(id);
  }

  async addAgentPreset(preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    if (!preset.id || !preset.name) {
      throw new Error("Agent preset id and name are required");
    }
    const existing = await this.storage.loadAgentPreset(preset.id);
    if (existing) {
      throw new Error(`Agent preset already exists: ${preset.id}`);
    }
    await this.storage.saveAgentPreset(preset);
    return preset;
  }

  async updateAgentPreset(id: string, preset: AgentPreset): Promise<AgentPreset> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentPreset(id);
    if (!existing) {
      throw new Error(`Agent preset not found: ${id}`);
    }
    await this.storage.saveAgentPreset(preset);
    return preset;
  }

  async deleteAgentPreset(id: string): Promise<void> {
    this.ensureInitialized();
    const existing = await this.storage.loadAgentPreset(id);
    if (!existing) {
      throw new Error(`Agent preset not found: ${id}`);
    }
    if (existing.builtIn) {
      throw new Error(`Built-in agent preset is read-only: ${id}`);
    }
    await this.storage.deleteAgentPreset(id);
  }

  async close(): Promise<void> {
    if (this.storage) {
      await this.storage.close();
    }
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
