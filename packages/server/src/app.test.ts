import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { AgentSwarm, LLMBackendConfig, SwarmConfig } from "@agent-swarm/core";
import { createApp } from "./app.js";

function createMockSwarm(): AgentSwarm {
  let llmConfig: LLMBackendConfig = {
    apiKeys: {
      anthropic: "",
      openai: "",
    },
  };

  const swarms = new Map<string, SwarmConfig>();
  const routerSwarm: SwarmConfig = {
    id: "router_swarm",
    name: "Router Swarm",
    mode: "router",
    agents: [
      {
        id: "router_agent_1",
        name: "Router Agent 1",
        description: "Agent for router mode",
        systemPrompt: "You are router agent 1",
        model: {
          provider: "openai",
          modelId: "gpt-4o-mini",
        },
      },
    ],
    orchestrator: {
      id: "router_agent_1",
      name: "Router Agent 1",
      description: "Agent for router mode",
      systemPrompt: "You are router agent 1",
      model: {
        provider: "openai",
        modelId: "gpt-4o-mini",
      },
    },
  };
  swarms.set(routerSwarm.id, routerSwarm);

  const directSwarm: SwarmConfig = {
    id: "__direct_chat",
    name: "openai/gpt-4o-mini",
    mode: "sequential",
    agents: [
      {
        id: "direct-agent",
        name: "openai/gpt-4o-mini",
        description: "Direct chat",
        systemPrompt: "You are a helpful assistant.",
        model: {
          provider: "openai",
          modelId: "gpt-4o-mini",
        },
      },
    ],
  };
  swarms.set(directSwarm.id, directSwarm);

  const mock = {
    listSwarms: () => Array.from(swarms.values()),
    getSwarmConfig: (id: string) => swarms.get(id),
    addSwarmConfig: async (config: SwarmConfig) => {
      swarms.set(config.id, config);
      return config;
    },
    updateSwarmConfig: async (id: string, config: SwarmConfig) => {
      if (!swarms.has(id)) {
        throw new Error("Swarm not found");
      }
      swarms.set(id, config);
      return config;
    },
    deleteSwarmConfig: async (id: string) => {
      if (!swarms.has(id)) {
        throw new Error("Swarm not found");
      }
      swarms.delete(id);
    },
    listConversations: async () => [],
    createConversation: async () => ({ getId: () => "conv_test" }),
    getMessages: async () => [],
    clearConversationContext: async (conversationId: string) => ({
      conversationId,
      contextResetAt: Date.now(),
    }),
    resumeConversation: async () => ({ getId: () => "conv_test" }),
    deleteConversation: async () => undefined,
    getLLMConfig: () => JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig,
    updateLLMConfig: async (next: LLMBackendConfig) => {
      llmConfig = JSON.parse(JSON.stringify(next)) as LLMBackendConfig;
      return JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig;
    },
  };

  return mock as unknown as AgentSwarm;
}

async function startTestServer() {
  const app = createApp(createMockSwarm());
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}

test("GET /api/health returns healthy status", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    const data = await response.json() as { status: string; timestamp: number };

    assert.equal(response.status, 200);
    assert.equal(data.status, "ok");
    assert.equal(typeof data.timestamp, "number");
  } finally {
    await server.close();
  }
});

test("PUT /api/config persists config via updateLLMConfig and returns masked api key", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKeys: {
          openai: "sk-test-1234567890123456",
        },
      }),
    });

    const data = await response.json() as {
      data: {
        apiKeys: Record<string, string>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(data.data.apiKeys.openai, "sk-test-...3456");
  } finally {
    await server.close();
  }
});

test("PUT /api/swarms/:id merges existing config and auto-fills router orchestrator", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/swarms/router_swarm`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Router Swarm Updated",
        mode: "router",
        agents: [
          {
            id: "router_agent_1",
            name: "Router Agent 1",
            description: "Agent for router mode",
            systemPrompt: "You are router agent 1",
            model: {
              provider: "openai",
              modelId: "gpt-4o-mini",
            },
          },
        ],
      }),
    });

    const data = await response.json() as { data: SwarmConfig };

    assert.equal(response.status, 200);
    assert.equal(data.data.name, "Router Swarm Updated");
    assert.equal(data.data.mode, "router");
    assert.equal(data.data.orchestrator?.id, "router_agent_1");
  } finally {
    await server.close();
  }
});

test("DELETE /api/swarms/:id removes swarm", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/swarms/router_swarm`, {
      method: "DELETE",
    });

    const data = await response.json() as { success: boolean };

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
  } finally {
    await server.close();
  }
});

test("GET /api/swarms hides virtual direct-chat swarms", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/swarms`);
    const data = await response.json() as { data: SwarmConfig[] };

    assert.equal(response.status, 200);
    assert.ok(data.data.every((item) => !item.id.startsWith("__direct_")));
    assert.ok(data.data.some((item) => item.id === "router_swarm"));
  } finally {
    await server.close();
  }
});

test("POST /api/conversations/:id/context/clear resets runtime context boundary", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/conversations/conv_test/context/clear`, {
      method: "POST",
    });
    const data = await response.json() as {
      data: {
        conversationId: string;
        contextResetAt: number;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(data.data.conversationId, "conv_test");
    assert.equal(typeof data.data.contextResetAt, "number");
  } finally {
    await server.close();
  }
});
