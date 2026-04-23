import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { AgentSwarm } from "./swarm.js";
import type { AgentSwarmRootConfig, SwarmConfig, EventLogLevel, SwarmEvent } from "./types.js";

function createTestDbPath(testName: string): string {
  return join(
    tmpdir(),
    `agent-swarm-${testName}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
}

function cleanupDb(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

function createSwarmConfig(id: string): SwarmConfig {
  return {
    id,
    name: id,
    mode: "sequential",
    agents: [
      {
        id: `${id}_agent_1`,
        name: "Agent 1",
        description: "Test agent",
        systemPrompt: "You are a test agent",
        model: {
          provider: "openai",
          modelId: "gpt-4o-mini",
        },
      },
    ],
  };
}

function createRootConfig(
  dbPath: string,
  swarms: SwarmConfig[],
  eventLogLevel?: EventLogLevel,
): AgentSwarmRootConfig {
  return {
    llm: {
      apiKeys: {
        anthropic: "",
        openai: "",
      },
    },
    storage: {
      type: "sqlite",
      path: dbPath,
    },
    swarms,
    eventLogLevel,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 0);
  });
}

describe("AgentSwarm persistence", () => {
  it("uses database swarms as the source of truth across restarts", async () => {
    const dbPath = createTestDbPath("swarms");
    cleanupDb(dbPath);

    const first = new AgentSwarm({
      config: createRootConfig(dbPath, []),
    });

    await first.init();
    await first.addSwarmConfig(createSwarmConfig("persisted_swarm"));
    await first.close();

    const second = new AgentSwarm({
      config: createRootConfig(dbPath, []),
    });

    await second.init();
    const swarms = second.listSwarms();

    expect(swarms).toHaveLength(1);
    expect(swarms[0].id).toBe("persisted_swarm");

    await second.close();
    cleanupDb(dbPath);
  });

  it("persists and restores global LLM config", async () => {
    const dbPath = createTestDbPath("llm-config");
    cleanupDb(dbPath);

    const first = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("bootstrap")]),
    });

    await first.init();
    await first.updateLLMConfig({
      apiKeys: {
        openai: "sk-test-1234567890",
      },
    });
    await first.close();

    const second = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("another_bootstrap")]),
    });

    await second.init();
    const llmConfig = second.getLLMConfig();

    expect(llmConfig.apiKeys.openai).toBe("sk-test-1234567890");

    await second.close();
    cleanupDb(dbPath);
  });

  it("cleans invalid persisted swarms during init", async () => {
    const dbPath = createTestDbPath("router-normalize");
    cleanupDb(dbPath);

    const routerSwarmWithoutOrchestrator: SwarmConfig = {
      id: "router_swarm",
      name: "Router Swarm",
      mode: "router",
      agents: [
        {
          id: "router_agent_1",
          name: "Router Agent 1",
          description: "Fallback orchestrator",
          systemPrompt: "You are a router agent",
          model: {
            provider: "openai",
            modelId: "gpt-4o-mini",
          },
        },
      ],
    };

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [routerSwarmWithoutOrchestrator]),
    });

    await swarm.init();
    expect(swarm.listSwarms()).toHaveLength(0);
    await swarm.close();
    cleanupDb(dbPath);
  });

  it("deletes swarm with dependent conversations", async () => {
    const dbPath = createTestDbPath("delete-swarm");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("delete_target")]),
    });

    await swarm.init();
    await swarm.createConversation("delete_target", "to be deleted");

    await expect(swarm.deleteSwarmConfig("delete_target")).resolves.toBeUndefined();
    expect(swarm.listSwarms()).toHaveLength(0);

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("isolates direct-chat model selection per conversation", async () => {
    const dbPath = createTestDbPath("direct-conversation");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });

    await swarm.init();

    const first = await swarm.createDirectConversation("openai", "gpt-4o-mini");
    const firstConversation = await swarm.getConversation(first.getId());
    expect(firstConversation?.swarmId).toBe("__direct_chat");
    expect(firstConversation?.directModel).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });

    const second = await swarm.createDirectConversation("anthropic", "claude-3-5-sonnet");
    const secondConversation = await swarm.getConversation(second.getId());
    expect(secondConversation?.swarmId).toBe("__direct_chat");
    expect(secondConversation?.directModel).toEqual({
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    const resumedFirst = await swarm.resumeConversation(first.getId()) as unknown as { swarmConfig: SwarmConfig };
    expect(resumedFirst.swarmConfig.agents[0]?.model).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });

    const resumedSecond = await swarm.resumeConversation(second.getId()) as unknown as { swarmConfig: SwarmConfig };
    expect(resumedSecond.swarmConfig.agents[0]?.model).toEqual({
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    await swarm.close();

    const restarted = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await restarted.init();

    const persistedDirectSwarms = restarted.listSwarms().filter((item) => item.id.startsWith("__direct_"));
    expect(persistedDirectSwarms).toHaveLength(1);
    expect(persistedDirectSwarms[0].id).toBe("__direct_chat");

    await restarted.close();
    cleanupDb(dbPath);
  });

  it("clears context without deleting history messages", async () => {
    const dbPath = createTestDbPath("clear-context");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await swarm.init();

    const conversation = await swarm.createConversation("default_swarm");
    const conversationId = conversation.getId();
    const internalStorage = (swarm as unknown as { storage: {
      appendMessage: (
        conversationId: string,
        message: {
          id: string;
          role: string;
          content: string;
          timestamp: number;
          createdAt: number;
        },
      ) => Promise<void>;
    } }).storage;

    const baseTimestamp = Date.now();
    await internalStorage.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "before reset",
      timestamp: baseTimestamp,
      createdAt: baseTimestamp,
    });
    await internalStorage.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "before reset reply",
      timestamp: baseTimestamp + 1,
      createdAt: baseTimestamp + 1,
    });

    const historyBeforeClear = await swarm.getMessages(conversationId);
    expect(historyBeforeClear).toHaveLength(2);

    const clearResult = await swarm.clearConversationContext(conversationId);
    expect(clearResult.conversationId).toBe(conversationId);
    expect(typeof clearResult.contextResetAt).toBe("number");
    expect(clearResult.markerMessage.role).toBe("notification");
    expect(clearResult.markerMessage.content).toContain("已清空上下文");
    expect(typeof clearResult.markerMessage.metadata).toBe("string");
    const conversationAfterClear = await swarm.getConversation(conversationId);
    expect(conversationAfterClear?.contextResetAt).toBe(clearResult.contextResetAt);

    const resumedWithoutNewMessages = await swarm.resumeConversation(conversationId) as unknown as {
      restoredMessages: Array<{ role: string }>;
    };
    expect(resumedWithoutNewMessages.restoredMessages).toHaveLength(0);

    const postResetTimestamp = clearResult.contextResetAt + 1;
    await internalStorage.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "after reset",
      timestamp: postResetTimestamp,
      createdAt: postResetTimestamp,
    });

    const resumedWithNewMessage = await swarm.resumeConversation(conversationId) as unknown as {
      restoredMessages: Array<{ role: string }>;
    };
    expect(resumedWithNewMessage.restoredMessages).toHaveLength(1);
    expect(resumedWithNewMessage.restoredMessages[0]?.role).toBe("user");

    const historyAfterClear = await swarm.getMessages(conversationId);
    expect(historyAfterClear).toHaveLength(4);

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("persists only key events when eventLogLevel is key", async () => {
    const dbPath = createTestDbPath("event-log-key");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")], "key"),
    });
    await swarm.init();

    const conversation = await swarm.createConversation("default_swarm");
    const internalConversation = conversation as unknown as { emit: (event: SwarmEvent) => void };
    const internalStorage = (swarm as unknown as { storage: {
      getEvents: (conversationId: string, eventType?: string) => Promise<Array<{ eventType: string }>>;
    } }).storage;

    internalConversation.emit({
      type: "message_update",
      agentId: "default_swarm_agent_1",
      delta: "streaming",
    });
    internalConversation.emit({
      type: "handoff",
      fromAgentId: "default_swarm_agent_1",
      toAgentId: "default_swarm_agent_2",
    });

    await flushAsync();

    const events = await internalStorage.getEvents(conversation.getId());
    expect(events.map((event) => event.eventType)).toEqual(["handoff"]);

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("skips event persistence when eventLogLevel is none", async () => {
    const dbPath = createTestDbPath("event-log-none");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")], "none"),
    });
    await swarm.init();

    const conversation = await swarm.createConversation("default_swarm");
    const internalConversation = conversation as unknown as { emit: (event: SwarmEvent) => void };
    const internalStorage = (swarm as unknown as { storage: {
      getEvents: (conversationId: string, eventType?: string) => Promise<Array<{ eventType: string }>>;
    } }).storage;

    internalConversation.emit({
      type: "error",
      error: new Error("test error"),
    });

    await flushAsync();

    const events = await internalStorage.getEvents(conversation.getId());
    expect(events).toHaveLength(0);

    await swarm.close();
    cleanupDb(dbPath);
  });
});
