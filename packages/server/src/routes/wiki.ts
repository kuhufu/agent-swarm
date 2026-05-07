import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { AgentSwarm, WikiPageInput } from "@agent-swarm/core";
import { resolveRequestUserId } from "../middleware/auth.js";
import { parseDocumentText, parseMultipartBody, readRequestBody } from "./documents.js";

export function wikiRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/wiki/pages", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.json({ data: [] });
      res.json({ data: await swarm.wikiStore.listPages(userId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/wiki/pages/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });
      const page = await swarm.wikiStore.getPage(req.params.id as string, userId);
      if (!page) return res.status(404).json({ error: "Wiki 页面不存在" });
      res.json({ data: page });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/wiki/pages", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });
      const page = await swarm.wikiStore.createPage(userId, normalizePageInput(req.body ?? {}));
      res.status(201).json({ data: page });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/wiki/pages/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });
      const page = await swarm.wikiStore.updatePage(req.params.id as string, userId, normalizePageInput(req.body ?? {}, true));
      res.json({ data: page });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/wiki/pages/:id", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });
      await swarm.wikiStore.deletePage(req.params.id as string, userId);
      res.json({ data: { deleted: true } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/wiki/pages/:id/regenerate", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });

      const page = await swarm.wikiStore.getPage(req.params.id as string, userId);
      if (!page) return res.status(404).json({ error: "Wiki 页面不存在" });
      if (!swarm.vectorStore) return res.status(404).json({ error: "来源资料未初始化" });

      const sourceDocuments = [];
      for (const sourceDocumentId of page.sourceDocumentIds) {
        const doc = await swarm.vectorStore.getDocument(sourceDocumentId, userId);
        if (doc?.content?.trim()) {
          sourceDocuments.push(doc);
        }
      }
      if (sourceDocuments.length === 0) {
        return res.status(400).json({ error: "没有可用于重新生成的来源资料" });
      }

      const combinedContent = sourceDocuments
        .map((doc) => [`# ${doc.title}`, doc.content].join("\n\n"))
        .join("\n\n---\n\n");
      const result = await swarm.generateWikiPagesFromDocument({
        userId,
        documentId: sourceDocuments[0]?.id ?? page.sourceDocumentIds[0] ?? page.id,
        title: page.title,
        content: combinedContent,
      });
      const updated = await swarm.wikiStore.getPage(page.id, userId);
      res.json({ data: { ...result, page: updated ?? result.pages[0] ?? page } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/wiki/search", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.json({ data: [] });
      const { query, topK } = req.body ?? {};
      if (!query) return res.status(400).json({ error: "query 不能为空" });
      const results = await swarm.wikiStore.search(String(query), typeof topK === "number" ? topK : 5, userId);
      res.json({ data: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/wiki/ingest-document", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });

      const contentType = req.headers["content-type"] ?? "";
      let filename: string;
      let text: string;

      if (contentType.includes("multipart/form-data")) {
        const multipart = parseMultipartBody(contentType, await readRequestBody(req));
        const file = multipart.files.find((item) => item.fieldName === "file") ?? multipart.files[0];
        if (!file) return res.status(400).json({ error: "缺少上传文件" });
        filename = (multipart.fields.title?.trim() || file.filename).trim();
        text = await parseDocumentText(file.filename, file.data);
      } else {
        const { filename: rawFilename, content } = req.body ?? {};
        if (!rawFilename || !content) {
          return res.status(400).json({ error: "filename 和 content 不能为空" });
        }
        filename = String(rawFilename);
        text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      }

      if (!text.trim()) {
        return res.status(400).json({ error: "文档内容不能为空" });
      }

      const documentId = randomUUID();
      if (swarm.vectorStore) {
        await swarm.vectorStore.addDocument(
          { id: documentId, userId, title: filename, source: "wiki_ingest", content: text, createdAt: Date.now() },
          buildDocumentChunks(documentId, text),
        );
      }
      const result = await swarm.generateWikiPagesFromDocument({
        userId,
        documentId,
        title: filename,
        content: text,
      });

      res.status(201).json({ data: { documentId, ...result } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/wiki/ingest-document/:documentId", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      if (!swarm.wikiStore) return res.status(404).json({ error: "Wiki 未初始化" });
      if (!swarm.vectorStore) return res.status(404).json({ error: "来源资料未初始化" });

      const documentId = req.params.documentId as string;
      const doc = await swarm.vectorStore.getDocument(documentId, userId);
      if (!doc?.content?.trim()) {
        return res.status(404).json({ error: "来源资料不存在或内容为空" });
      }

      const result = await swarm.generateWikiPagesFromDocument({
        userId,
        documentId,
        title: doc.title,
        content: doc.content,
      });

      res.status(201).json({ data: { documentId, ...result } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function normalizePageInput(raw: Record<string, unknown>, partial = false): WikiPageInput {
  const input: WikiPageInput = {
    title: typeof raw.title === "string" ? raw.title : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    content: typeof raw.content === "string" ? raw.content : "",
    aliases: normalizeStringArray(raw.aliases),
    tags: normalizeStringArray(raw.tags),
    status: raw.status === "draft" || raw.status === "stale" || raw.status === "active" ? raw.status : "active",
    sourceDocumentIds: normalizeStringArray(raw.sourceDocumentIds),
  };
  if (Array.isArray(raw.claims)) {
    input.claims = raw.claims.map(normalizeClaimInput).filter((claim): claim is NonNullable<WikiPageInput["claims"]>[number] => claim !== null);
  }
  if (Array.isArray(raw.links)) {
    input.links = raw.links.map(normalizeLinkInput).filter((link): link is NonNullable<WikiPageInput["links"]>[number] => link !== null);
  }
  if (!partial) {
    return input;
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== "";
  })) as WikiPageInput;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
}

function normalizeClaimInput(value: unknown): NonNullable<WikiPageInput["claims"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  return {
    text,
    sourceDocumentId: typeof raw.sourceDocumentId === "string" ? raw.sourceDocumentId : undefined,
    sourceChunkIndex: typeof raw.sourceChunkIndex === "number" ? raw.sourceChunkIndex : undefined,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
  };
}

function normalizeLinkInput(value: unknown): NonNullable<WikiPageInput["links"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const toTitle = typeof raw.toTitle === "string" ? raw.toTitle.trim() : "";
  if (!toTitle) return null;
  const relation = raw.relation === "prerequisite"
    || raw.relation === "explains"
    || raw.relation === "contradicts"
    || raw.relation === "part_of"
    || raw.relation === "related"
    ? raw.relation
    : "related";
  return { toTitle, relation };
}

function buildDocumentChunks(documentId: string, text: string) {
  return splitTextIntoChunks(text).map((chunkText, index) => ({
    id: randomUUID(),
    documentId,
    content: chunkText,
    index,
  }));
}

function splitTextIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = `${current.slice(-overlap)}${para}`;
    } else {
      current += `${current ? "\n\n" : ""}${para}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
