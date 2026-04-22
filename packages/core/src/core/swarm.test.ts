import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { AgentSwarm } from "./swarm.js";
import type { AgentSwarmRootConfig, SwarmConfig } from "./types.js";

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

function createRootConfig(dbPath: string, swarms: SwarmConfig[]): AgentSwarmRootConfig {
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
  };
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
});
