import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SQLiteVectorStore } from "../storage/vector-store-sqlite.js";
import { createRetrieveKnowledgeTool } from "./retrieve-knowledge.js";

function testDbPath(): string {
  return join(
    tmpdir(),
    `rag-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
}

const USER = "user-test-001";

describe("SQLiteVectorStore", () => {
  const dbPath = testDbPath();
  const store = new SQLiteVectorStore(dbPath);

  beforeAll(async () => {
    await store.init();
  });

  afterAll(() => {
    rmSync(dbPath, { force: true });
  });

  it("adds and searches documents via FTS", async () => {
    await store.addDocument(
      {
        id: "doc-1",
        userId: USER,
        title: "React 入门",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "chunk-1a", documentId: "doc-1", content: "React 是一个用于构建用户界面的 JavaScript 库", index: 0 },
        { id: "chunk-1b", documentId: "doc-1", content: "Vue 是一款渐进式 JavaScript 框架", index: 1 },
      ],
    );

    await store.addDocument(
      {
        id: "doc-2",
        userId: USER,
        title: "Node.js 指南",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "chunk-2a", documentId: "doc-2", content: "Node.js 使用事件驱动、非阻塞 I/O 模型", index: 0 },
      ],
    );

    // Search should match React document
    const results = await store.search("React 用户界面", 3, USER);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].document.title).toBe("React 入门");

    // No match
    const empty = await store.search("完全没有匹配的内容 xyzabc", 3, USER);
    expect(empty).toHaveLength(0);
  });

  it("supports space-separated mixed-language keyword search", async () => {
    await store.addDocument(
      {
        id: "doc-auth-cn",
        userId: USER,
        title: "身份验证指南",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "chunk-auth-cn", documentId: "doc-auth-cn", content: "系统使用身份验证流程校验用户登录态", index: 0 },
      ],
    );
    await store.addDocument(
      {
        id: "doc-auth-en",
        userId: USER,
        title: "Authentication Guide",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "chunk-auth-en", documentId: "doc-auth-en", content: "Authentication middleware validates bearer tokens", index: 0 },
      ],
    );

    const results = await store.search("认证 身份验证 Authentication", 10, USER);
    const titles = results.map((result) => result.document.title);
    expect(titles).toContain("身份验证指南");
    expect(titles).toContain("Authentication Guide");
  });

  it("gets and replaces document content with rebuilt chunks", async () => {
    await store.addDocument(
      {
        id: "doc-edit",
        userId: USER,
        title: "可编辑文档",
        source: "manual",
        content: "旧内容用于检索",
        createdAt: Date.now(),
      },
      [
        { id: "chunk-edit-old", documentId: "doc-edit", content: "旧内容用于检索", index: 0 },
      ],
    );

    const detail = await store.getDocument("doc-edit", USER);
    expect(detail?.content).toBe("旧内容用于检索");

    await store.addDocument(
      {
        id: "doc-edit",
        userId: USER,
        title: "可编辑文档",
        source: "manual",
        content: "新内容重新索引",
        createdAt: detail!.createdAt,
      },
      [
        { id: "chunk-edit-new", documentId: "doc-edit", content: "新内容重新索引", index: 0 },
      ],
    );

    const oldResults = await store.search("旧内容", 3, USER);
    const newResults = await store.search("新内容", 3, USER);
    expect(oldResults.some((result) => result.document.id === "doc-edit")).toBe(false);
    expect(newResults.some((result) => result.document.id === "doc-edit")).toBe(true);
    expect((await store.getDocument("doc-edit", USER))?.content).toBe("新内容重新索引");
  });

  it("lists documents for a user", async () => {
    const docs = await store.listDocuments(USER);
    expect(docs.length).toBeGreaterThanOrEqual(2);
    expect(docs.some((d) => d.title === "React 入门")).toBe(true);
  });

  it("deletes a document", async () => {
    await store.addDocument(
      {
        id: "doc-del",
        userId: USER,
        title: "临时文档",
        source: "test",
        createdAt: Date.now(),
      },
      [{ id: "chunk-del", documentId: "doc-del", content: "这是一篇临时文档用于测试删除功能", index: 0 }],
    );

    let results = await store.search("临时文档", 3, USER);
    expect(results.length).toBeGreaterThanOrEqual(1);

    await store.deleteDocument("doc-del", USER);

    results = await store.search("临时文档", 3, USER);
    expect(results).toHaveLength(0);
  });

  it("clears all data", async () => {
    await store.clear();
    const docs = await store.listDocuments(USER);
    expect(docs).toHaveLength(0);
  });
});

describe("createRetrieveKnowledgeTool", () => {
  const dbPath = testDbPath();
  const store = new SQLiteVectorStore(dbPath);

  beforeAll(async () => {
    await store.init();
    await store.addDocument(
      {
        id: "tool-doc",
        userId: USER,
        title: "TypeScript 手册",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "tc-1", documentId: "tool-doc", content: "TypeScript 是 JavaScript 的超集，添加了类型系统", index: 0 },
        { id: "tc-2", documentId: "tool-doc", content: "TypeScript 由 Microsoft 开发和维护", index: 1 },
      ],
    );
  });

  afterAll(() => {
    rmSync(dbPath, { force: true });
  });

  it("returns matching chunks for a query", async () => {
    const tool = createRetrieveKnowledgeTool(store, { userId: USER });
    const result = await tool.execute("call-1", { query: "TypeScript 类型系统", topK: 3 });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(result.content[0].type).toBe("text");
    expect(text).toContain("TypeScript");
    expect(text).toContain("JavaScript 的超集");
  });

  it("filters tool results by user", async () => {
    await store.addDocument(
      {
        id: "other-user-doc",
        userId: "other-user",
        title: "私有文档",
        source: "manual",
        createdAt: Date.now(),
      },
      [
        { id: "other-user-chunk", documentId: "other-user-doc", content: "TypeScript 私有隔离内容", index: 0 },
      ],
    );

    const tool = createRetrieveKnowledgeTool(store, { userId: USER });
    const result = await tool.execute("call-user-filter", { query: "私有隔离内容", topK: 3 });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("知识库中没有找到相关内容。");
  });

  it("returns empty message when nothing matches", async () => {
    const tool = createRetrieveKnowledgeTool(store, { userId: USER });
    const result = await tool.execute("call-2", { query: "xyz不存在的内容abc" });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(result.content[0].type).toBe("text");
    expect(text).toBe("知识库中没有找到相关内容。");
  });

  it("requires userId", () => {
    expect(() => createRetrieveKnowledgeTool(store, { userId: "" })).toThrow("retrieve_knowledge requires userId");
  });
});
