import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { AgentSwarm, LLMBackendConfig, SwarmConfig } from "@agent-swarm/core";
import { createApp } from "./app.js";
import { signToken } from "./middleware/auth.js";

const TEST_USER = { id: "test-user", username: "tester" };
const TEST_TOKEN = signToken(TEST_USER);

function withAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    ...headers,
  };
}

function createMockSwarm() {
  const usageCalls = {
    conversation: [] as Array<{ conversationId: string; userId: string | undefined }>,
    daily: [] as Array<{ userId: string | undefined; days: number | undefined }>,
    llm: [] as Array<{ filter: Record<string, unknown>; userId: string | undefined }>,
  };
  let llmConfig: LLMBackendConfig = {
    apiKeys: { anthropic: "", openai: "" },
  };
  const swarms = new Map<string, SwarmConfig>();

  swarms.set("router_swarm", {
    id: "router_swarm",
    name: "Router Swarm",
    mode: "router",
    agents: [{ id: "router_agent_1", name: "Router Agent 1", description: "Agent for router mode", systemPrompt: "You are router agent 1", model: { provider: "openai", modelId: "gpt-4o-mini" } }],
    orchestrator: { id: "router_agent_1", name: "Router Agent 1", description: "Agent for router mode", systemPrompt: "You are router agent 1", model: { provider: "openai", modelId: "gpt-4o-mini" } },
  });

  swarms.set("__direct_chat", {
    id: "__direct_chat",
    name: "openai/gpt-4o-mini",
    mode: "sequential",
    agents: [{ id: "direct-agent", name: "openai/gpt-4o-mini", description: "Direct chat", systemPrompt: "You are a helpful assistant.", model: { provider: "openai", modelId: "gpt-4o-mini" } }],
  });

  const mock = {
    listSwarms: () => Array.from(swarms.values()),
    getSwarmConfig: (id: string) => swarms.get(id),
    addSwarmConfig: async (config: SwarmConfig) => { swarms.set(config.id, config); return config; },
    updateSwarmConfig: async (id: string, config: SwarmConfig) => { if (!swarms.has(id)) throw new Error("Swarm not found"); swarms.set(id, config); return config; },
    deleteSwarmConfig: async (id: string) => { if (!swarms.has(id)) throw new Error("Swarm not found"); swarms.delete(id); },
    listAgentPresets: async () => [],
    getAgentPreset: async () => null,
    addAgentPreset: async (preset: any) => preset,
    updateAgentPreset: async (_id: string, preset: any) => preset,
    deleteAgentPreset: async () => undefined,
    listConversations: async () => [],
    listAllConversations: async () => [],
    createConversation: async () => ({ getId: () => "conv_test" }),
    getConversation: async (id: string) => {
      if (id === "test_conv" || id === "conv_test") {
        return {
          id,
          swarmId: "router_swarm",
          title: "test",
          enabledTools: [],
          thinkingLevel: "off",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }
      return null;
    },
    updateConversationPreferences: async () => undefined,
    clearConversationContext: async (conversationId: string) => ({ conversationId, contextResetAt: Date.now() }),
    resumeConversation: async () => ({ getId: () => "conv_test" }),
    deleteConversation: async () => undefined,
    getConversationUsage: async (conversationId: string, userId: string) => {
      usageCalls.conversation.push({ conversationId, userId });
      return [];
    },
    getDailyUsage: async (userId: string, days?: number) => {
      usageCalls.daily.push({ userId, days });
      return [];
    },
    logLLMCall: async () => undefined,
    queryLLMCalls: async (filter: Record<string, unknown>, userId: string) => {
      usageCalls.llm.push({ filter, userId });
      return [];
    },
    getMessages: async () => [],
    getLLMConfig: () => JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig,
    updateLLMConfig: async (next: LLMBackendConfig) => { llmConfig = JSON.parse(JSON.stringify(next)) as LLMBackendConfig; return JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig; },
  };

  return {
    swarm: mock as unknown as AgentSwarm,
    usageCalls,
  };
}

async function startTestServer() {
  const { swarm, usageCalls } = createMockSwarm();
  const app = createApp(swarm);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    usageCalls,
    close: async () => { await new Promise<void>((resolve, reject) => { server.close((err) => (err ? reject(err) : resolve())); }); },
  };
}

describe("API routes", () => {
  it("GET /api/health returns healthy status", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/health`);
      const data = await response.json() as { status: string; timestamp: number };
      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(typeof data.timestamp).toBe("number");
    } finally {
      await server.close();
    }
  });

  it("POST /api/auth/logout returns success", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: { loggedOut: boolean } };
      expect(response.status).toBe(200);
      expect(data.data.loggedOut).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("PUT /api/config persists config and returns masked api key", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ apiKeys: { openai: "sk-test-1234567890123456" } }),
      });
      const data = await response.json() as { data: { apiKeys: Record<string, string> } };
      expect(response.status).toBe(200);
      expect(data.data.apiKeys.openai).toBe("sk-test-...3456");
    } finally {
      await server.close();
    }
  });

  it("PUT /api/swarms/:id merges existing config and auto-fills router orchestrator", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms/router_swarm`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "Router Swarm Updated", mode: "router", agents: [{ id: "router_agent_1", name: "Router Agent 1", description: "Agent for router mode", systemPrompt: "You are router agent 1", model: { provider: "openai", modelId: "gpt-4o-mini" } }] }),
      });
      const data = await response.json() as { data: SwarmConfig };
      expect(response.status).toBe(200);
      expect(data.data.name).toBe("Router Swarm Updated");
      expect(data.data.mode).toBe("router");
      expect(data.data.orchestrator?.id).toBe("router_agent_1");
    } finally {
      await server.close();
    }
  });

  it("DELETE /api/swarms/:id removes swarm", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms/router_swarm`, {
        method: "DELETE",
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { success: boolean };
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("GET /api/swarms hides virtual direct-chat swarms", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: SwarmConfig[] };
      expect(response.status).toBe(200);
      expect(data.data.every((item) => !item.id.startsWith("__direct_"))).toBe(true);
      expect(data.data.some((item) => item.id === "router_swarm")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("POST /api/conversations/:id/context/clear resets runtime context boundary", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/conversations/conv_test/context/clear`, {
        method: "POST",
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: { conversationId: string; contextResetAt: number } };
      expect(response.status).toBe(200);
      expect(data.data.conversationId).toBe("conv_test");
      expect(typeof data.data.contextResetAt).toBe("number");
    } finally {
      await server.close();
    }
  });

  it("POST /api/agents creates a new agent preset", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/agents`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ id: "test-agent", name: "Test Agent", description: "A test agent", category: "test", tags: ["test"] }),
      });
      expect(response.status).toBe(201);
      const data = await response.json() as { data: any };
      expect(data.data.name).toBe("Test Agent");
    } finally {
      await server.close();
    }
  });

  it("POST /api/swarms validates required fields", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "", agents: [] }),
      });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("POST /api/swarms validates agent requirements", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "Test Swarm", mode: "router", agents: [] }),
      });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("GET /api/conversations/:id/usage returns usage data", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/conversations/test_conv/usage`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: any[] };
      expect(response.status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(server.usageCalls.conversation[0]).toEqual({
        conversationId: "test_conv",
        userId: TEST_USER.id,
      });
    } finally {
      await server.close();
    }
  });

  it("GET /api/usage/daily returns daily usage data", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/usage/daily?days=7`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: any[] };
      expect(response.status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(server.usageCalls.daily[0]).toEqual({
        userId: TEST_USER.id,
        days: 7,
      });
    } finally {
      await server.close();
    }
  });

  it("GET /api/llm/calls passes user scope", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/llm/calls?providerId=openai&days=7&limit=5`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: any[] };
      expect(response.status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(server.usageCalls.llm[0]).toEqual({
        filter: {
          conversationId: undefined,
          providerId: "openai",
          modelId: undefined,
          days: 7,
          limit: 5,
        },
        userId: TEST_USER.id,
      });
    } finally {
      await server.close();
    }
  });
});
