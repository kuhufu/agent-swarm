import type { SwarmConfig, AgentSwarmRootConfig, LLMBackendConfig, ApiProtocol } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { ConversationPreferences } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { Conversation } from "./conversation.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { complete } from "@mariozechner/pi-ai";
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

export class AgentSwarm {
  private static readonly LLM_CONFIG_KEY = "llm_config";

  private config: AgentSwarmRootConfig;
  private storage: IStorage;
  private interventionHandler?: InterventionHandler;
  private swarmConfigs: Map<string, SwarmConfig> = new Map();
  private _initialized = false;

  constructor(options: AgentSwarmOptions) {
    if (!options.config && !options.configPath) {
      throw new Error("Either config or configPath must be provided");
    }

    this.config = options.config ?? this.loadConfigFromPath(options.configPath!);
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

    const conversation = new Conversation(
      conv.id,
      swarmConfig,
      this.storage,
      this.config.llm,
      this.interventionHandler,
      await this.storage.getMessages(conversationId),
    );

    return conversation;
  }

  /**
   * List conversations for a swarm.
   */
  async listConversations(swarmId: string) {
    this.ensureInitialized();
    return this.storage.listConversations(swarmId);
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
    if (options.override?.baseUrl !== undefined || options.override?.apiProtocol !== undefined) {
      llmConfig.providers = {
        ...(llmConfig.providers ?? {}),
        [provider]: {
          ...(llmConfig.providers?.[provider] ?? {}),
          ...(options.override.baseUrl !== undefined ? { baseUrl: options.override.baseUrl } : {}),
          ...(options.override.apiProtocol !== undefined ? { apiProtocol: options.override.apiProtocol } : {}),
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
}
