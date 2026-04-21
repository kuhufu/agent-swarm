import type { SwarmConfig, AgentSwarmRootConfig, SwarmEvent, LLMBackendConfig } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { Conversation } from "./conversation.js";

export interface AgentSwarmOptions {
  configPath?: string;
  config?: AgentSwarmRootConfig;
  storage?: IStorage;
  interventionHandler?: InterventionHandler;
}

export class AgentSwarm {
  private config: AgentSwarmRootConfig;
  private storage: IStorage;
  private interventionHandler?: InterventionHandler;
  private swarmConfigs: Map<string, SwarmConfig> = new Map();
  private _initialized = false;

  constructor(options: AgentSwarmOptions) {
    if (!options.config && !options.configPath) {
      throw new Error("Either config or configPath must be provided");
    }

    this.config = options.config!;
    this.storage = options.storage ?? new SqliteStorage(this.config.storage.path);
    this.interventionHandler = options.interventionHandler;

    // Index swarm configs
    for (const swarm of this.config.swarms) {
      this.swarmConfigs.set(swarm.id, swarm);
    }
  }

  async init(): Promise<void> {
    if (this._initialized) return;

    await this.storage.init();

    // Persist swarm configs to storage
    for (const swarm of this.config.swarms) {
      const existing = await this.storage.loadSwarm(swarm.id);
      if (!existing) {
        await this.storage.saveSwarm(swarm);
      }
    }

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
    );

    // Load history into agents
    const messages = await this.storage.getMessages(conversationId);
    // TODO: restore messages into agent state

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
  addSwarmConfig(config: SwarmConfig): SwarmConfig {
    if (this.swarmConfigs.has(config.id)) {
      throw new Error(`Swarm already exists: ${config.id}`);
    }
    this.swarmConfigs.set(config.id, config);
    // Persist to storage if initialized
    if (this._initialized) {
      this.storage.saveSwarm(config).catch(() => { /* ignore storage errors */ });
    }
    // Also add to root config
    this.config.swarms.push(config);
    return config;
  }

  getLLMConfig(): LLMBackendConfig {
    return { ...this.config.llm };
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
}
