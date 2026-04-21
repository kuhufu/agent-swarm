import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { AgentSwarm, LLMBackendConfig } from "@agent-swarm/core";
import { createApp } from "./app.js";

function createMockSwarm(): AgentSwarm {
  let llmConfig: LLMBackendConfig = {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeys: {
      anthropic: "",
      openai: "",
    },
  };

  const mock = {
    listSwarms: () => [],
    getSwarmConfig: () => undefined,
    addSwarmConfig: async (config: any) => config,
    listConversations: async () => [],
    createConversation: async () => ({ getId: () => "conv_test" }),
    getMessages: async () => [],
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
        defaultProvider: "openai",
        defaultModel: "gpt-4o-mini",
        apiKeys: {
          openai: "sk-test-1234567890123456",
        },
      }),
    });

    const data = await response.json() as {
      data: {
        defaultProvider: string;
        defaultModel: string;
        apiKeys: Record<string, string>;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(data.data.defaultProvider, "openai");
    assert.equal(data.data.defaultModel, "gpt-4o-mini");
    assert.equal(data.data.apiKeys.openai, "sk-test-...3456");
  } finally {
    await server.close();
  }
});
