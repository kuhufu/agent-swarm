import type { SwarmConfig, AgentSwarmRootConfig, LLMBackendConfig } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { Conversation } from "./conversation.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export interface AgentSwarmOptions {
  configPath?: string;
  config?: AgentSwarmRootConfig;
  storage?: IStorage;
  interventionHandler?: InterventionHandler;
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
    this.swarmConfigs.clear();
    for (const swarm of persistedSwarms) {
      this.swarmConfigs.set(swarm.id, swarm);
    }
    this.config.swarms = [...persistedSwarms];

    this._initialized = true;
  }

  /**
   * Create a new conversation for a swarm.
   */
  async createConversation(swarmId: string, title?: string): Promise<Conversation> {
    this.ensureInitialized();
    const swarmConfig = this.swarmConfigs.get(swarmId);
    if (!swarmConfig) {
      throw new Error(`Swarm not found: ${swarmId}`);
    }

    const conv = await this.storage.createConversation(swarmId, title);

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
    if (this.swarmConfigs.has(config.id)) {
      throw new Error(`Swarm already exists: ${config.id}`);
    }

    await this.storage.saveSwarm(config);
    this.swarmConfigs.set(config.id, config);
    this.config.swarms.push(config);
    return config;
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
}
