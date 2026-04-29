import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { AgentSwarm } from "./swarm.js";
import type { AgentSwarmRootConfig, SwarmConfig, EventLogLevel, SwarmEvent } from "./types.js";
import { createWorkspaceManager } from "../tools/workspace/manager.js";

const TEST_USER_ID = "user-test";

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
    await first.addSwarmConfig(createSwarmConfig("persisted_swarm"), TEST_USER_ID);
    await first.close();

    const second = new AgentSwarm({
      config: createRootConfig(dbPath, []),
    });

    await second.init();
    const swarms = await second.listSwarms(TEST_USER_ID);

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
    expect(await swarm.listSwarms(TEST_USER_ID)).toHaveLength(0);
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
    await swarm.createConversation(TEST_USER_ID, "delete_target", "to be deleted", undefined);

    await expect(swarm.deleteSwarmConfig("delete_target", TEST_USER_ID)).resolves.toBeUndefined();
    expect(await swarm.listSwarms(TEST_USER_ID)).toHaveLength(0);

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("cleans conversation workspace when deleting a conversation", async () => {
    const dbPath = createTestDbPath("delete-conversation-workspace");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("workspace_swarm")]),
    });

    await swarm.init();
    const conversation = await swarm.createConversation(TEST_USER_ID, "workspace_swarm", "workspace", undefined);
    const workspace = createWorkspaceManager(conversation.getId());
    await workspace.writeFile("result.txt", "temporary workspace file");

    expect(existsSync(workspace.baseDir)).toBe(true);

    await swarm.deleteConversation(conversation.getId(), TEST_USER_ID);

    expect(existsSync(workspace.baseDir)).toBe(false);

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

    const first = await swarm.createDirectConversation(TEST_USER_ID, "openai", "gpt-4o-mini", undefined, undefined);
    const firstConversation = await swarm.getConversation(first.getId(), TEST_USER_ID);
    expect(firstConversation?.swarmId).toBe(`__direct_chat_${TEST_USER_ID}`);
    expect(firstConversation?.directModel).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });

    const second = await swarm.createDirectConversation(TEST_USER_ID, "anthropic", "claude-3-5-sonnet", undefined, undefined);
    const secondConversation = await swarm.getConversation(second.getId(), TEST_USER_ID);
    expect(secondConversation?.swarmId).toBe(`__direct_chat_${TEST_USER_ID}`);
    expect(secondConversation?.directModel).toEqual({
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    const resumedFirst = await swarm.resumeConversation(first.getId(), TEST_USER_ID) as unknown as { swarmConfig: SwarmConfig };
    expect(resumedFirst.swarmConfig.agents[0]?.model).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });

    const resumedSecond = await swarm.resumeConversation(second.getId(), TEST_USER_ID) as unknown as { swarmConfig: SwarmConfig };
    expect(resumedSecond.swarmConfig.agents[0]?.model).toEqual({
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    await swarm.close();

    const restarted = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await restarted.init();

    const persistedDirectSwarms = (await restarted.listSwarms(TEST_USER_ID)).filter((item) => item.id.startsWith("__direct_"));
    expect(persistedDirectSwarms).toHaveLength(1);
    expect(persistedDirectSwarms[0].id).toBe(`__direct_chat_${TEST_USER_ID}`);

    await restarted.close();
    cleanupDb(dbPath);
  });

  it("preserves conversation preferences when forking", async () => {
    const dbPath = createTestDbPath("fork-preferences");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await swarm.init();

    const source = await swarm.createConversation(TEST_USER_ID, "default_swarm", "source", {
      enabledTools: ["web_search", "mcp"],
      thinkingLevel: "high",
      directModel: { provider: "openai", modelId: "gpt-4o-mini" },
    });

    const forked = await swarm.forkConversation(source.getId(), {}, TEST_USER_ID);
    const sourceInfo = await swarm.getConversation(source.getId(), TEST_USER_ID);
    const forkedInfo = await swarm.getConversation(forked.getId(), TEST_USER_ID);

    expect(sourceInfo?.enabledTools).toEqual(["web_search", "mcp"]);
    expect(forkedInfo?.enabledTools).toEqual(sourceInfo?.enabledTools);
    expect(forkedInfo?.thinkingLevel).toBe(sourceInfo?.thinkingLevel);
    expect(forkedInfo?.directModel).toEqual(sourceInfo?.directModel);

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("isolates usage and llm-call analytics by user", async () => {
    const dbPath = createTestDbPath("usage-isolation");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await swarm.init();

    const privateUserId = "user_a";
    const privateConversation = await swarm.createDirectConversation(privateUserId, "openai", "gpt-4o-mini", undefined, undefined);
    const otherConversation = await swarm.createDirectConversation("user_b", "openai", "gpt-4o-mini", undefined, undefined);

    const internalStorage = (swarm as unknown as { storage: {
      appendMessage: (
        conversationId: string,
        message: {
          id: string;
          role: string;
          content: string;
          metadata: string;
          timestamp: number;
          createdAt: number;
        },
      ) => Promise<void>;
    } }).storage;

    const timestamp = Date.now();
    await internalStorage.appendMessage(privateConversation.getId(), {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "private",
      metadata: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        usage: {
          input: 11,
          output: 7,
          cost: { total: 0.12 },
        },
      }),
      timestamp,
      createdAt: timestamp,
    });
    await internalStorage.appendMessage(otherConversation.getId(), {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "public",
      metadata: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        usage: {
          input: 999,
          output: 888,
          cost: { total: 9.99 },
        },
      }),
      timestamp,
      createdAt: timestamp,
    });

    await swarm.logLLMCall({
      id: crypto.randomUUID(),
      conversationId: privateConversation.getId(),
      providerId: "openai",
      modelId: "gpt-4o-mini",
      promptTokens: 11,
      completionTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0.12,
      latencyMs: 100,
      status: "ok",
      timestamp,
    });
    await swarm.logLLMCall({
      id: crypto.randomUUID(),
      conversationId: otherConversation.getId(),
      providerId: "openai",
      modelId: "gpt-4o-mini",
      promptTokens: 999,
      completionTokens: 888,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 9.99,
      latencyMs: 100,
      status: "ok",
      timestamp,
    });

    const privateDailyUsage = await swarm.getDailyUsage(privateUserId, 7);
    expect(privateDailyUsage).toHaveLength(1);
    expect(privateDailyUsage[0].inputTokens).toBe(11);
    expect(privateDailyUsage[0].outputTokens).toBe(7);

    const privateConversationUsage = await swarm.getConversationUsage(privateConversation.getId(), privateUserId);
    expect(privateConversationUsage).toHaveLength(1);
    expect(privateConversationUsage[0].totalInputTokens).toBe(11);

    const deniedConversationUsage = await swarm.getConversationUsage(otherConversation.getId(), privateUserId);
    expect(deniedConversationUsage).toHaveLength(0);

    const privateCalls = await swarm.queryLLMCalls({}, privateUserId);
    expect(privateCalls).toHaveLength(1);
    expect(privateCalls[0].conversationId).toBe(privateConversation.getId());

    await swarm.close();
    cleanupDb(dbPath);
  });

  it("clears context without deleting history messages", async () => {
    const dbPath = createTestDbPath("clear-context");
    cleanupDb(dbPath);

    const swarm = new AgentSwarm({
      config: createRootConfig(dbPath, [createSwarmConfig("default_swarm")]),
    });
    await swarm.init();

    const conversation = await swarm.createConversation(TEST_USER_ID, "default_swarm", undefined, undefined);
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

    const baseTimestamp = Date.now() - 10_000;
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

    const historyBeforeClear = await swarm.getMessages(conversationId, TEST_USER_ID);
    expect(historyBeforeClear).toHaveLength(2);

    const clearResult = await swarm.clearConversationContext(conversationId, TEST_USER_ID);
    expect(clearResult.conversationId).toBe(conversationId);
    expect(typeof clearResult.contextResetAt).toBe("number");
    expect(clearResult.markerMessage.role).toBe("notification");
    expect(clearResult.markerMessage.content).toContain("已清空上下文");
    expect(typeof clearResult.markerMessage.metadata).toBe("string");
    const conversationAfterClear = await swarm.getConversation(conversationId, TEST_USER_ID);
    expect(conversationAfterClear?.contextResetAt).toBe(clearResult.contextResetAt);

    const resumedWithoutNewMessages = await swarm.resumeConversation(conversationId, TEST_USER_ID) as unknown as {
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

    const resumedWithNewMessage = await swarm.resumeConversation(conversationId, TEST_USER_ID) as unknown as {
      restoredMessages: Array<{ role: string }>;
    };
    expect(resumedWithNewMessage.restoredMessages).toHaveLength(1);
    expect(resumedWithNewMessage.restoredMessages[0]?.role).toBe("user");

    const historyAfterClear = await swarm.getMessages(conversationId, TEST_USER_ID);
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

    const conversation = await swarm.createConversation(TEST_USER_ID, "default_swarm", undefined, undefined);
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

    const conversation = await swarm.createConversation(TEST_USER_ID, "default_swarm", undefined, undefined);
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
