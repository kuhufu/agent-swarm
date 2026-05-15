import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { SwarmConfig, SwarmEvent, LLMBackendConfig, EventLogLevel, ThinkingLevel } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import type { StoredMessage } from "../storage/interface.js";
import type { InterventionHandler } from "../intervention/handler.js";
import type { ClientToolExecutionResult } from "../tools/client-bridge.js";
import type { ToolRuntimeAvailability } from "../tools/runtime.js";
import { createToolRuntimeOptions } from "../tools/runtime.js";
import { createWorkspaceManager } from "../tools/workspace/manager.js";
import { storedToMessage } from "../storage/message-mapper.js";
import type { ModeExecutor } from "../modes/types.js";
import { ChatMode } from "../modes/chat.js";
import { SwarmMode } from "../modes/swarm-mode.js";
import { DebateMode } from "../modes/debate.js";
import { TeamMode } from "../modes/team.js";
import { RefineMode } from "../modes/refine.js";
import { ConversationEventBus } from "./conversation/event-bus.js";
import { InterventionOrchestrator } from "./conversation/intervention.js";
import { AgentManager } from "./conversation/agent-manager.js";
import { buildModeContext } from "./conversation/context-builder.js";

export interface ConversationPromptOptions {
  enabledTools?: string[];
  thinkingEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
  clientToolExecutor?: (
    request: { toolName: string; toolCallId: string; params: unknown },
  ) => Promise<ClientToolExecutionResult>;
  images?: ImageContent[];
}

type ToolAvailabilityProvider = (context: {
  conversationId: string;
  userId: string;
  workspaceId?: string;
}) => ToolRuntimeAvailability | Promise<ToolRuntimeAvailability>;

export class Conversation {
  private id: string;
  private swarmConfig: SwarmConfig;
  private storage: IStorage;
  private llmConfig: LLMBackendConfig;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly toolAvailabilityProvider?: ToolAvailabilityProvider;

  private eventBus: ConversationEventBus;
  private interventionOrch: InterventionOrchestrator;
  private agentManager: AgentManager;
  private metadata: Record<string, unknown> = {};

  private _aborted = false;

  constructor(
    id: string,
    userId: string,
    swarmConfig: SwarmConfig,
    storage: IStorage,
    llmConfig: LLMBackendConfig,
    interventionHandler?: InterventionHandler,
    restoredHistory: StoredMessage[] = [],
    eventLogLevel: EventLogLevel = "key",
    toolAvailabilityProvider?: ToolAvailabilityProvider,
    workspaceId?: string,
    restoredMetadata?: Record<string, unknown>,
  ) {
    this.id = id;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.swarmConfig = swarmConfig;
    this.storage = storage;
    this.llmConfig = llmConfig;
    this.toolAvailabilityProvider = toolAvailabilityProvider;
    this.metadata = restoredMetadata ?? {};

    const runtimeOptions = {
      ...createToolRuntimeOptions(),
      thinkingEnabled: undefined as boolean | undefined,
      thinkingLevel: undefined as ThinkingLevel | undefined,
    };

    this.eventBus = new ConversationEventBus(id, storage, swarmConfig.agents, eventLogLevel);
    this.interventionOrch = new InterventionOrchestrator(swarmConfig, this.eventBus);
    this.interventionOrch.setHandler(interventionHandler);
    this.agentManager = new AgentManager(
      swarmConfig,
      llmConfig,
      runtimeOptions,
      restoredHistory.map((msg) => storedToMessage(msg)),
    );
  }

  getMetadata(key: string): unknown {
    return this.metadata[key];
  }

  async setMetadata(key: string, value: unknown): Promise<void> {
    this.metadata[key] = value;
    await this.storage.updateConversationMetadata(this.id, this.metadata);
  }

  getId(): string { return this.id; }

  async *prompt(message: string, options: ConversationPromptOptions = {}): AsyncGenerator<SwarmEvent> {
    this._aborted = false;
    const toolAvailability = await this.resolveToolAvailability();
    const runtimeOptions = {
      ...createToolRuntimeOptions({
        ...toolAvailability,
        enabledTools: options.enabledTools,
        clientToolExecutor: options.clientToolExecutor,
      }),
      thinkingEnabled: typeof options.thinkingEnabled === "boolean" ? options.thinkingEnabled : undefined,
      thinkingLevel: options.thinkingLevel,
    };
    this.agentManager.updateRuntimeOptions(runtimeOptions);

    const userContentStr = buildUserContentStr(message, options.images);
    await this.storage.appendMessage(this.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: userContentStr,
      timestamp: Date.now(),
    });

    await setTitleFromFirstMessage(this.storage, this.id, message, options.images);

    const startEvent: SwarmEvent = { type: "swarm_start", swarmId: this.swarmConfig.id, conversationId: this.id };
    this.eventBus.emit(startEvent);
    yield startEvent;

    try {
      const executor = this.getModeExecutor();
      const context = buildModeContext({
        swarmConfig: this.swarmConfig,
        message,
        images: options.images,
        conversationId: this.id,
        storage: this.storage,
        llmConfig: this.llmConfig,
        agentManager: this.agentManager,
        eventBus: this.eventBus,
        interventionOrch: this.interventionOrch,
        abortFn: () => this.abort(),
        isAbortedFn: () => this._aborted,
        getMetadata: (key: string) => this.getMetadata(key),
        setMetadata: (key: string, value: unknown) => this.setMetadata(key, value),
      });
      yield* executor.execute(context);
    } catch (err) {
      const errorEvent: SwarmEvent = { type: "error", error: err as Error } as SwarmEvent;
      this.eventBus.emit(errorEvent);
      yield errorEvent;
    }

    const endEvent: SwarmEvent = {
      type: "swarm_end",
      swarmId: this.swarmConfig.id,
      conversationId: this.id,
      finalMessage: "",
    } as SwarmEvent;
    this.eventBus.emit(endEvent);
    yield endEvent;
  }

  onEvent(fn: (event: SwarmEvent) => void): () => void {
    return this.eventBus.onEvent(fn);
  }

  onIntervention(callback: (point: any, context: any) => Promise<any>): void {
    this.interventionOrch.setCallback(callback);
  }

  abort(): void {
    this._aborted = true;
    if (this.workspaceId) {
      void createWorkspaceManager(this.workspaceId).cleanupContainers().catch(() => {});
    }
    this.agentManager.abortAll();
  }

  async getHistory() {
    return this.storage.getMessages(this.id);
  }

  private getModeExecutor(): ModeExecutor {
    switch (this.swarmConfig.mode) {
      case "chat": return new ChatMode();
      case "swarm": return new SwarmMode();
      case "debate": return new DebateMode();
      case "team": return new TeamMode();
      case "refine": return new RefineMode();
      default: throw new Error(`Unknown mode: ${this.swarmConfig.mode}`);
    }
  }

  private async resolveToolAvailability(): Promise<ToolRuntimeAvailability> {
    if (!this.toolAvailabilityProvider) return {};
    return this.toolAvailabilityProvider({
      conversationId: this.id,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }
}

// ── Standalone helpers ──

function buildUserContentStr(message: string, images?: ImageContent[]): string {
  const parts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
  if (message) parts.push({ type: "text", text: message });
  if (images?.length) {
    for (const img of images) {
      parts.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text ?? "";
  }
  return JSON.stringify(parts);
}

async function setTitleFromFirstMessage(
  storage: IStorage,
  conversationId: string,
  message: string,
  images?: ImageContent[],
): Promise<void> {
  const history = await storage.getMessages(conversationId);
  if (history.length !== 1) return;
  const titleText = message || (images?.length ? "图片消息" : "消息");
  const title = titleText.length > 50 ? titleText.slice(0, 50) + "…" : titleText;
  await storage.updateConversationTitle(conversationId, title);
}
