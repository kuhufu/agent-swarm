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

    // Search without userId should still work (no tenant filter)
    const resultsAll = await store.search("Node.js", 3);
    expect(resultsAll.length).toBeGreaterThanOrEqual(1);

    // No match
    const empty = await store.search("完全没有匹配的内容 xyzabc", 3, USER);
    expect(empty).toHaveLength(0);
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
    const tool = createRetrieveKnowledgeTool(store);
    const result = await tool.execute("call-1", { query: "TypeScript 类型系统", topK: 3 });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("TypeScript");
    expect(result.content[0].text).toContain("JavaScript 的超集");
  });

  it("returns empty message when nothing matches", async () => {
    const tool = createRetrieveKnowledgeTool(store);
    const result = await tool.execute("call-2", { query: "xyz不存在的内容abc" });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("知识库中没有找到相关内容。");
  });
});
