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
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-20250514",
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
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
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

    expect(llmConfig.defaultProvider).toBe("openai");
    expect(llmConfig.defaultModel).toBe("gpt-4o-mini");
    expect(llmConfig.apiKeys.openai).toBe("sk-test-1234567890");

    await second.close();
    cleanupDb(dbPath);
  });
});
