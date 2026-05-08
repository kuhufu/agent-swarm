import { describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { WorkspaceManager, type AgentSwarm, type LLMBackendConfig, type SwarmConfig } from "@agent-swarm/core";
import { createApp } from "./app.js";
import { signToken } from "./middleware/auth.js";

const TEST_USER = { id: "test-user", username: "tester", role: "admin" as const };
const TEST_TOKEN = signToken(TEST_USER);
const NORMAL_USER_TOKEN = signToken({ id: "normal-user", username: "normal", role: "user" });

function withAuthHeaders(headers: Record<string, string> = {}, token = TEST_TOKEN): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
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
  const templates = new Map<string, any>();
  const uploadedDocs: Array<{
    id: string;
    title: string;
    source: string;
    content: string;
    chunks: number;
    chunksData: Array<{ id: string; documentId: string; content: string; index: number }>;
    userId: string;
  }> = [];
  const wikiPages: any[] = [];

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
    listAgentTemplates: async () => Array.from(templates.values()),
    addAgentTemplate: async (template: any) => { templates.set(template.id, template); return template; },
    updateAgentTemplate: async (id: string, template: any) => { if (!templates.has(id)) throw new Error("Agent template not found"); templates.set(id, template); return template; },
    deleteAgentTemplate: async (id: string) => { if (!templates.has(id)) throw new Error("Agent template not found"); templates.delete(id); },
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
    getConversationEvents: async (conversationId: string, userId: string, eventType?: string) => {
      if (conversationId !== "test_conv" && conversationId !== "conv_test") {
        throw new Error("Conversation not found");
      }
      const events = [
        {
          id: "event_1",
          agentId: "router_agent_1",
          eventType: "agent_start",
          eventData: JSON.stringify({ agentId: "router_agent_1", agentName: "Router Agent 1" }),
          timestamp: 1,
        },
        {
          id: "event_2",
          agentId: "router_agent_1",
          eventType: "handoff",
          eventData: JSON.stringify({ fromAgentId: "router_agent_1", toAgentId: "worker" }),
          timestamp: 2,
        },
      ];
      return eventType ? events.filter((event) => event.eventType === eventType) : events;
    },
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
    vectorStore: {
      listDocuments: async () => [],
      getDocument: async (documentId: string, userId: string) => {
        const doc = uploadedDocs.find((item) => item.id === documentId && item.userId === userId);
        return doc
          ? { id: doc.id, userId: doc.userId, title: doc.title, source: doc.source, content: doc.content, createdAt: 1 }
          : null;
      },
      listDocumentChunks: async (documentId: string, userId: string) =>
        uploadedDocs.find((item) => item.id === documentId && item.userId === userId)?.chunksData ?? [],
      deleteDocument: async () => undefined,
      search: async () => [],
      addDocument: async (doc: any, chunks: any[]) => {
        uploadedDocs.push({
          id: doc.id,
          title: doc.title,
          source: doc.source,
          content: doc.content,
          chunks: chunks.length,
          chunksData: chunks,
          userId: doc.userId,
        });
      },
    },
    wikiStore: {
      listPages: async (userId: string) => wikiPages.filter((page) => page.userId === userId),
      getPage: async (pageId: string, userId: string) => wikiPages.find((page) => page.id === pageId && page.userId === userId) ?? null,
      createPage: async (userId: string, input: any) => {
        const page = {
          id: `wiki_${wikiPages.length + 1}`,
          userId,
          title: input.title,
          summary: input.summary,
          content: input.content,
          aliases: input.aliases ?? [],
          tags: input.tags ?? [],
          status: input.status ?? "active",
          sourceDocumentIds: input.sourceDocumentIds ?? [],
          claims: input.claims ?? [],
          links: input.links ?? [],
          createdAt: 1,
          updatedAt: 1,
        };
        wikiPages.push(page);
        return page;
      },
      updatePage: async (pageId: string, userId: string, input: any) => {
        const index = wikiPages.findIndex((page) => page.id === pageId && page.userId === userId);
        if (index < 0) throw new Error("Wiki page not found");
        wikiPages[index] = { ...wikiPages[index], ...input, id: pageId, userId };
        return wikiPages[index];
      },
      deletePage: async (pageId: string, userId: string) => {
        const index = wikiPages.findIndex((page) => page.id === pageId && page.userId === userId);
        if (index >= 0) wikiPages.splice(index, 1);
      },
      search: async (query: string, _topK: number | undefined, userId: string) =>
        wikiPages
          .filter((page) => page.userId === userId && `${page.title} ${page.summary} ${page.content}`.includes(query))
          .map((page) => ({ page, claims: page.claims ?? [], score: 1 })),
    },
    generateWikiPagesFromDocument: async (input: any) => {
      const existing = wikiPages.find((page) => page.userId === input.userId && page.title === input.title);
      if (existing) {
        existing.summary = input.content.slice(0, 80);
        existing.content = input.content;
        existing.sourceDocumentIds = Array.from(new Set([...existing.sourceDocumentIds, input.documentId]));
        existing.claims = [{ text: input.content.slice(0, 120), sourceDocumentId: input.documentId }];
        return { pages: [existing], generatedBy: "fallback" };
      }
      const page = {
        id: `wiki_${wikiPages.length + 1}`,
        userId: input.userId,
        title: input.title,
        summary: input.content.slice(0, 80),
        content: input.content,
        aliases: [],
        tags: ["generated"],
        status: "active",
        sourceDocumentIds: [input.documentId],
        claims: [{ text: input.content.slice(0, 120), sourceDocumentId: input.documentId }],
        links: [],
        createdAt: 1,
        updatedAt: 1,
      };
      wikiPages.push(page);
      return { pages: [page], generatedBy: "fallback" };
    },
    getLLMConfig: () => JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig,
    updateLLMConfig: async (next: LLMBackendConfig) => { llmConfig = JSON.parse(JSON.stringify(next)) as LLMBackendConfig; return JSON.parse(JSON.stringify(llmConfig)) as LLMBackendConfig; },
  };

  return {
    swarm: mock as unknown as AgentSwarm,
    usageCalls,
    uploadedDocs,
    wikiPages,
  };
}

async function startTestServer() {
  const { swarm, usageCalls, uploadedDocs, wikiPages } = createMockSwarm();
  const app = createApp(swarm);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    usageCalls,
    uploadedDocs,
    wikiPages,
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

  it("GET /api/config hides api keys for non-admin users but returns models", async () => {
    const server = await startTestServer();
    try {
      await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          apiKeys: { openai: "sk-test-1234567890123456" },
          models: [{ id: "m1", name: "M1", provider: "openai", modelId: "m1" }],
        }),
      });

      const response = await fetch(`${server.baseUrl}/api/config`, {
        headers: withAuthHeaders({}, NORMAL_USER_TOKEN),
      });
      const data = await response.json() as { data: { apiKeys: Record<string, string>; models: any[] } };
      expect(response.status).toBe(200);
      expect(data.data.apiKeys).toEqual({});
      expect(data.data.models).toEqual([{ id: "m1", name: "M1", provider: "openai", modelId: "m1" }]);
    } finally {
      await server.close();
    }
  });

  it("PUT /api/config persists saved models", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          models: [
            {
              id: "gpt-4o-mini",
              name: "GPT 4o Mini",
              provider: "openai",
              modelId: "gpt-4o-mini",
            },
          ],
        }),
      });
      const data = await response.json() as { data: { models: any[] } };
      expect(response.status).toBe(200);
      expect(data.data.models).toEqual([
        {
          id: "gpt-4o-mini",
          name: "GPT 4o Mini",
          provider: "openai",
          modelId: "gpt-4o-mini",
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("PUT /api/config can clear saved models", async () => {
    const server = await startTestServer();
    try {
      await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          models: [{ id: "m1", name: "M1", provider: "openai", modelId: "m1" }],
        }),
      });

      const response = await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ models: [] }),
      });
      const data = await response.json() as { data: { models: any[] } };
      expect(response.status).toBe(200);
      expect(data.data.models).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("PUT /api/config requires admin role", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/config`, {
        method: "PUT",
        headers: withAuthHeaders({ "content-type": "application/json" }, NORMAL_USER_TOKEN),
        body: JSON.stringify({ apiKeys: { openai: "sk-denied" } }),
      });
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("POST /api/templates requires admin role", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/templates`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }, NORMAL_USER_TOKEN),
        body: JSON.stringify({ id: "template", name: "Template" }),
      });
      expect(response.status).toBe(403);
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

  it("GET /api/conversations/:id/events returns conversation trace events", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/conversations/test_conv/events?type=handoff`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: Array<{ eventType: string; eventData: string }> };
      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0]?.eventType).toBe("handoff");
      expect(JSON.parse(data.data[0]?.eventData ?? "{}").toAgentId).toBe("worker");
    } finally {
      await server.close();
    }
  });

  it("GET /api/conversations/:id/workspace/files returns workspace artifacts and preview content", async () => {
    const server = await startTestServer();
    const workspace = new WorkspaceManager("conv_test");
    const artifactPath = `reports/artifact-${Date.now()}.txt`;
    try {
      await workspace.writeFile(artifactPath, "workspace artifact content");
      await workspace.writeFile("src/example.ts", "export const answer: number = 42;\n");

      const listResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files`, {
        headers: withAuthHeaders(),
      });
      const listData = await listResponse.json() as { data: Array<{ path: string; kind: string; previewable: boolean; downloadUrl: string; final: boolean }> };
      const artifact = listData.data.find((item) => item.path === artifactPath);

      expect(listResponse.status).toBe(200);
      expect(artifact).toMatchObject({
        path: artifactPath,
        kind: "text",
        previewable: true,
      });
      expect(artifact?.downloadUrl).toContain("/api/conversations/conv_test/workspace/files/download");

      const contentResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files/content?path=${encodeURIComponent(artifactPath)}`, {
        headers: withAuthHeaders(),
      });
      const contentData = await contentResponse.json() as { data: { path: string; content: string; truncated: boolean } };

      expect(contentResponse.status).toBe(200);
      expect(contentData.data).toMatchObject({
        path: artifactPath,
        content: "workspace artifact content",
        truncated: false,
      });

      const codeResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files/content?path=${encodeURIComponent("src/example.ts")}`, {
        headers: withAuthHeaders(),
      });
      const codeData = await codeResponse.json() as { data: { path: string; kind: string; language?: string; content: string } };

      expect(codeResponse.status).toBe(200);
      expect(codeData.data).toMatchObject({
        path: "src/example.ts",
        kind: "code",
        language: "typescript",
        content: "export const answer: number = 42;\n",
      });

      const finalResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files/final`, {
        method: "PATCH",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ path: artifactPath, final: true }),
      });
      expect(finalResponse.status).toBe(200);

      const finalListResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files`, {
        headers: withAuthHeaders(),
      });
      const finalListData = await finalListResponse.json() as { data: Array<{ path: string; final: boolean }> };
      expect(finalListData.data.find((item) => item.path === artifactPath)?.final).toBe(true);

      const importResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files/import-document`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ path: artifactPath }),
      });
      const importData = await importResponse.json() as { data: { title: string; chunks: number } };
      expect(importResponse.status).toBe(201);
      expect(importData.data.title).toBe(artifactPath.split("/").pop());
      expect(server.uploadedDocs.at(-1)).toMatchObject({
        title: artifactPath.split("/").pop(),
        source: "workspace_artifact",
        content: "workspace artifact content",
        userId: TEST_USER.id,
      });

      const zipResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files/download-zip`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ paths: [artifactPath, "src/example.ts"] }),
      });
      const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
      expect(zipResponse.status).toBe(200);
      expect(zipResponse.headers.get("content-type")).toBe("application/zip");
      expect(zipBuffer.readUInt32LE(0)).toBe(0x04034b50);

      const deleteResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files?path=${encodeURIComponent(artifactPath)}`, {
        method: "DELETE",
        headers: withAuthHeaders(),
      });
      expect(deleteResponse.status).toBe(200);

      const afterDeleteResponse = await fetch(`${server.baseUrl}/api/conversations/conv_test/workspace/files`, {
        headers: withAuthHeaders(),
      });
      const afterDeleteData = await afterDeleteResponse.json() as { data: Array<{ path: string }> };
      expect(afterDeleteData.data.some((item) => item.path === artifactPath)).toBe(false);
      expect(afterDeleteData.data.some((item) => item.path === ".agent-swarm-artifacts.json")).toBe(false);
    } finally {
      await workspace.cleanup();
      await server.close();
    }
  });

  it("POST /api/documents/upload accepts multipart file uploads", async () => {
    const server = await startTestServer();
    try {
      const form = new FormData();
      form.append("file", new Blob(["# Hello\n\nKnowledge base content"], { type: "text/markdown" }), "hello.md");

      const response = await fetch(`${server.baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: withAuthHeaders(),
        body: form,
      });
      const data = await response.json() as { data: { title: string; chunks: number } };
      expect(response.status).toBe(201);
      expect(data.data.title).toBe("hello.md");
      expect(data.data.chunks).toBeGreaterThan(0);
      expect(server.uploadedDocs[0]).toMatchObject({
        title: "hello.md",
        source: "upload",
        content: "# Hello\n\nKnowledge base content",
        userId: TEST_USER.id,
      });
    } finally {
      await server.close();
    }
  });

  it("GET /api/documents/:id/chunks returns chunks for the current user", async () => {
    const server = await startTestServer();
    try {
      const form = new FormData();
      form.append("file", new Blob(["引用片段内容"], { type: "text/plain" }), "reference.txt");

      const uploadResponse = await fetch(`${server.baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: withAuthHeaders(),
        body: form,
      });
      const uploadData = await uploadResponse.json() as { data: { id: string } };

      const response = await fetch(`${server.baseUrl}/api/documents/${uploadData.data.id}/chunks`, {
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: Array<{ documentId: string; content: string; index: number }> };

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0]).toMatchObject({
        documentId: uploadData.data.id,
        content: "引用片段内容",
        index: 0,
      });
    } finally {
      await server.close();
    }
  });

  it("POST /api/wiki/ingest-document generates wiki pages and stores source document", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/wiki/ingest-document`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          filename: "登录态校验",
          content: "登录态校验要求认证中间件先校验 token。",
        }),
      });
      const data = await response.json() as { data: { documentId: string; pages: any[]; generatedBy: string } };

      expect(response.status).toBe(201);
      expect(data.data.generatedBy).toBe("fallback");
      expect(data.data.pages[0].title).toBe("登录态校验");
      expect(server.uploadedDocs[0]?.id).toBe(data.data.documentId);
      expect(server.wikiPages).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("POST /api/wiki/ingest-document/:documentId generates wiki from an existing document", async () => {
    const server = await startTestServer();
    try {
      const uploadResponse = await fetch(`${server.baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          filename: "支付回调",
          content: "支付回调需要校验签名并保证幂等。",
        }),
      });
      const uploadData = await uploadResponse.json() as { data: { id: string } };

      const response = await fetch(`${server.baseUrl}/api/wiki/ingest-document/${uploadData.data.id}`, {
        method: "POST",
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: { documentId: string; pages: any[]; generatedBy: string } };

      expect(response.status).toBe(201);
      expect(data.data.documentId).toBe(uploadData.data.id);
      expect(data.data.generatedBy).toBe("fallback");
      expect(data.data.pages[0]).toMatchObject({
        title: "支付回调",
        sourceDocumentIds: [uploadData.data.id],
      });
      expect(server.uploadedDocs).toHaveLength(1);
      expect(server.wikiPages).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("POST /api/wiki/search returns user-scoped wiki pages", async () => {
    const server = await startTestServer();
    try {
      await fetch(`${server.baseUrl}/api/wiki/pages`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          title: "认证中间件",
          summary: "认证中间件校验 token。",
          content: "认证中间件在业务路由前校验 token。",
          tags: ["auth"],
        }),
      });

      const response = await fetch(`${server.baseUrl}/api/wiki/search`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ query: "token" }),
      });
      const data = await response.json() as { data: Array<{ page: { title: string } }> };

      expect(response.status).toBe(200);
      expect(data.data[0]?.page.title).toBe("认证中间件");
    } finally {
      await server.close();
    }
  });

  it("POST /api/wiki/pages/:id/regenerate rebuilds from source documents", async () => {
    const server = await startTestServer();
    try {
      const ingestResponse = await fetch(`${server.baseUrl}/api/wiki/ingest-document`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          filename: "认证中间件",
          content: "认证中间件在业务路由前校验 token。",
        }),
      });
      const ingestData = await ingestResponse.json() as { data: { pages: any[] } };
      const pageId = ingestData.data.pages[0].id;

      const response = await fetch(`${server.baseUrl}/api/wiki/pages/${pageId}/regenerate`, {
        method: "POST",
        headers: withAuthHeaders(),
      });
      const data = await response.json() as { data: { page: { id: string; title: string }; generatedBy: string } };

      expect(response.status).toBe(200);
      expect(data.data.generatedBy).toBe("fallback");
      expect(data.data.page.id).toBe(pageId);
      expect(data.data.page.title).toBe("认证中间件");
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

  it("POST /api/swarms accepts intervention strategy records", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "Intervention Swarm",
          mode: "sequential",
          agents: [{ id: "agent_1", name: "Agent 1", description: "", systemPrompt: "", model: { provider: "openai", modelId: "gpt-4o-mini" } }],
          interventions: { before_tool_call: "confirm" },
        }),
      });
      const data = await response.json() as { data: SwarmConfig };
      expect(response.status).toBe(201);
      expect(data.data.interventions).toEqual({ before_tool_call: "confirm" });
    } finally {
      await server.close();
    }
  });

  it("POST /api/swarms rejects legacy intervention arrays", async () => {
    const server = await startTestServer();
    try {
      const response = await fetch(`${server.baseUrl}/api/swarms`, {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          name: "Bad Intervention Swarm",
          mode: "sequential",
          agents: [{ id: "agent_1", name: "Agent 1", description: "", systemPrompt: "", model: { provider: "openai", modelId: "gpt-4o-mini" } }],
          interventions: [{ point: "before_tool_call", strategy: "confirm" }],
        }),
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
