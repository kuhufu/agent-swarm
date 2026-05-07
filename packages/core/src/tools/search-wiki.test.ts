import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { AgentSwarm } from "../core/swarm.js";
import { SQLiteWikiStore } from "../storage/wiki-store-sqlite.js";
import { createSearchWikiTool } from "./search-wiki.js";

function testDbPath(): string {
  return join(tmpdir(), `wiki-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

const USER = "wiki-user-001";

describe("SQLiteWikiStore", () => {
  const dbPath = testDbPath();
  const store = new SQLiteWikiStore(dbPath);

  beforeAll(async () => {
    await store.init();
  });

  afterAll(() => {
    rmSync(dbPath, { force: true });
  });

  it("creates and searches wiki pages with claims", async () => {
    const page = await store.createPage(USER, {
      title: "登录态校验",
      summary: "系统通过认证中间件校验用户登录态。",
      content: "请求进入业务路由前会先经过认证中间件，校验 token 和用户身份。",
      aliases: ["Authentication", "身份验证"],
      tags: ["auth", "security"],
      sourceDocumentIds: ["doc-auth"],
      claims: [
        { text: "认证中间件会在业务路由前校验 token。", sourceDocumentId: "doc-auth", confidence: 0.9 },
      ],
      links: [
        { toTitle: "用户会话", relation: "related" },
      ],
    });

    const detail = await store.getPage(page.id, USER);
    expect(detail?.claims[0]?.text).toContain("token");
    expect(detail?.links[0]?.toTitle).toBe("用户会话");

    const results = await store.search("Authentication token", 5, USER);
    expect(results[0]?.page.title).toBe("登录态校验");
    expect(results[0]?.claims[0]?.text).toContain("token");
  });

  it("returns wiki search results from the agent tool", async () => {
    const tool = createSearchWikiTool(store, { userId: USER });
    const result = await tool.execute("tool-call-1", { query: "身份验证", topK: 3 });

    expect(result.content[0]?.type).toBe("text");
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("登录态校验");
    expect(result.details.length).toBeGreaterThan(0);
  });
});

describe("AgentSwarm wiki ingestion", () => {
  const storagePath = testDbPath();
  const wikiPath = testDbPath();
  const wikiStore = new SQLiteWikiStore(wikiPath);
  const swarm = new AgentSwarm({
    config: {
      llm: { apiKeys: {} },
      storage: { type: "sqlite", path: storagePath },
      swarms: [],
    },
    wikiStore,
  });

  beforeAll(async () => {
    await wikiStore.init();
    await swarm.init();
  });

  afterAll(async () => {
    await swarm.close();
    for (const path of [storagePath, `${storagePath}-wal`, `${storagePath}-shm`, wikiPath, `${wikiPath}-wal`, `${wikiPath}-shm`]) {
      rmSync(path, { force: true });
    }
  });

  it("merges repeated document ingestion into an existing wiki page", async () => {
    const first = await swarm.generateWikiPagesFromDocument({
      userId: USER,
      documentId: "doc-auth-1",
      title: "登录态校验",
      content: "登录态校验要求认证中间件先校验 token。",
    });
    const second = await swarm.generateWikiPagesFromDocument({
      userId: USER,
      documentId: "doc-auth-2",
      title: "登录态校验",
      content: "登录态校验还需要确认用户没有被禁用。",
    });

    expect(first.pages[0]?.id).toBe(second.pages[0]?.id);
    expect(second.pages[0]?.content).toContain("用户没有被禁用");
    expect(second.pages[0]?.sourceDocumentIds).toEqual(["doc-auth-1", "doc-auth-2"]);
    const pages = await wikiStore.listPages(USER);
    expect(pages).toHaveLength(1);
  });
});
