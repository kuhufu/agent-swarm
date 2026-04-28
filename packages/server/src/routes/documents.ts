import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { AgentSwarm } from "@agent-swarm/core";
import { resolveRequestUserId } from "../middleware/auth.js";

function parseDocumentText(filename: string, buffer: Buffer): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt" || ext === "md" || ext === "html" || ext === "htm") {
    return buffer.toString("utf-8");
  }
  if (ext === "json") {
    const obj = JSON.parse(buffer.toString("utf-8"));
    return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }
  return buffer.toString("utf-8");
}

function splitTextIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function buildDocumentChunks(documentId: string, text: string) {
  return splitTextIntoChunks(text).map((chunkText, i) => ({
    id: randomUUID(),
    documentId,
    content: chunkText,
    index: i,
  }));
}

export function documentRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/documents", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const store = (swarm as any).vectorStore;
      if (!store) return res.json({ data: [] });
      const docs = await store.listDocuments(userId);
      res.json({ data: docs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/documents/upload", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const { filename, content } = req.body ?? {};
      if (!filename || !content) {
        return res.status(400).json({ error: "filename 和 content 不能为空" });
      }

      const store = (swarm as any).vectorStore;
      if (!store) {
        return res.status(500).json({ error: "知识库未初始化" });
      }

      const docId = randomUUID();
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const chunkTexts = splitTextIntoChunks(text);
      const chunks = chunkTexts.map((chunkText, i) => ({
        id: randomUUID(),
        documentId: docId,
        content: chunkText,
        index: i,
      }));

      await store.addDocument(
        { id: docId, userId, title: filename, source: filename, content: text, createdAt: Date.now() },
        chunks,
      );

      res.status(201).json({ data: { id: docId, title: filename, chunks: chunks.length } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/documents/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const store = (swarm as any).vectorStore;
      if (!store) return res.status(404).json({ error: "知识库未初始化" });
      const doc = await store.getDocument(req.params.id as string, userId);
      if (!doc) return res.status(404).json({ error: "文档不存在" });
      res.json({ data: doc });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/documents/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const { filename, content } = req.body ?? {};
      if (!filename || !content) {
        return res.status(400).json({ error: "filename 和 content 不能为空" });
      }

      const store = (swarm as any).vectorStore;
      if (!store) return res.status(404).json({ error: "知识库未初始化" });

      const documentId = req.params.id as string;
      const existing = await store.getDocument(documentId, userId);
      if (!existing) return res.status(404).json({ error: "文档不存在" });

      const text = typeof content === "string" ? content : JSON.stringify(content);
      const chunks = buildDocumentChunks(documentId, text);
      await store.addDocument(
        {
          id: documentId,
          userId,
          title: filename,
          source: filename,
          content: text,
          createdAt: existing.createdAt,
        },
        chunks,
      );

      res.json({ data: { id: documentId, title: filename, chunks: chunks.length } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/documents/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const store = (swarm as any).vectorStore;
      if (!store) return res.status(404).json({ error: "知识库未初始化" });
      await store.deleteDocument(req.params.id as string, userId);
      res.json({ data: { deleted: true } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/documents/search", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });

      const { query, topK } = req.body ?? {};
      if (!query) return res.status(400).json({ error: "query 不能为空" });

      const store = (swarm as any).vectorStore;
      if (!store) return res.json({ data: [] });

      const results = await store.search(query, topK ?? 5, userId);
      res.json({ data: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
