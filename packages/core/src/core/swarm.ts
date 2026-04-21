import type { SwarmConfig, AgentSwarmRootConfig, SwarmEvent } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import { SqliteStorage } from "../storage/sqlite.js";

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

    // TODO: load from configPath if config not provided
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

  async createConversation(swarmId: string) {
    this.ensureInitialized();
    const swarmConfig = this.swarmConfigs.get(swarmId);
    if (!swarmConfig) {
      throw new Error(`Swarm not found: ${swarmId}`);
    }

    const { Conversation } = await import("./conversation.js");
    return new Conversation(swarmConfig, this.storage, this.interventionHandler);
  }

  async resumeConversation(conversationId: string) {
    this.ensureInitialized();
    // TODO: implement conversation resumption
    throw new Error("Not implemented yet");
  }

  async listConversations(swarmId: string) {
    this.ensureInitialized();
    return this.storage.listConversations(swarmId);
  }

  getSwarmConfig(swarmId: string): SwarmConfig | undefined {
    return this.swarmConfigs.get(swarmId);
  }

  listSwarms(): SwarmConfig[] {
    return Array.from(this.swarmConfigs.values());
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
