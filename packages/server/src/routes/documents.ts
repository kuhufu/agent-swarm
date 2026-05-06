import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { resolveRequestUserId } from "../middleware/auth.js";

interface UploadedFile {
  fieldName: string;
  filename: string;
  contentType?: string;
  data: Buffer;
}

interface MultipartPayload {
  fields: Record<string, string>;
  files: UploadedFile[];
}

async function parsePdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function parseDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parseDocumentText(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "html" || ext === "htm") {
    return buffer.toString("utf-8");
  }
  if (ext === "json") {
    const obj = JSON.parse(buffer.toString("utf-8"));
    return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }
  if (ext === "pdf") {
    return parsePdfText(buffer);
  }
  if (ext === "docx") {
    return parseDocxText(buffer);
  }
  throw new Error(`不支持的文件类型：.${ext || "unknown"}`);
}

async function readRequestBody(req: Request, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("文件大小不能超过 10MB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseContentDisposition(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (!rawKey || rawValueParts.length === 0) continue;
    const rawValue = rawValueParts.join("=");
    result[rawKey.toLowerCase()] = rawValue.replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipartBody(contentType: string, body: Buffer): MultipartPayload {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error("缺少 multipart boundary");
  }

  const boundaryText = `--${boundary}`;
  const raw = body.toString("binary");
  const parts = raw.split(boundaryText).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];

  for (const rawPart of parts) {
    const trimmedPart = rawPart.replace(/^\r\n/, "").replace(/\r\n$/, "");
    if (!trimmedPart) continue;

    const headerEnd = trimmedPart.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    const rawHeaders = trimmedPart.slice(0, headerEnd);
    const rawContent = trimmedPart.slice(headerEnd + 4);
    const headers: Record<string, string> = {};
    for (const line of rawHeaders.split("\r\n")) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }

    const disposition = headers["content-disposition"];
    if (!disposition) continue;
    const dispositionParams = parseContentDisposition(disposition);
    const fieldName = dispositionParams.name;
    if (!fieldName) continue;

    const contentBuffer = Buffer.from(rawContent, "binary");
    const filename = dispositionParams.filename
      ? Buffer.from(dispositionParams.filename, "binary").toString("utf-8")
      : undefined;
    if (filename) {
      files.push({
        fieldName,
        filename,
        contentType: headers["content-type"],
        data: contentBuffer,
      });
    } else {
      fields[fieldName] = contentBuffer.toString("utf-8");
    }
  }

  return { fields, files };
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

      const store = swarm.vectorStore;
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

      const store = swarm.vectorStore;
      if (!store) {
        return res.status(500).json({ error: "知识库未初始化" });
      }

      const contentType = req.headers["content-type"] ?? "";
      let filename: string;
      let text: string;

      if (contentType.includes("multipart/form-data")) {
        const multipart = parseMultipartBody(contentType, await readRequestBody(req));
        const file = multipart.files.find((item) => item.fieldName === "file") ?? multipart.files[0];
        if (!file) {
          return res.status(400).json({ error: "缺少上传文件" });
        }
        filename = (multipart.fields.title?.trim() || file.filename).trim();
        text = await parseDocumentText(file.filename, file.data);
      } else {
        const { filename: bodyFilename, content } = req.body ?? {};
        if (!bodyFilename || !content) {
          return res.status(400).json({ error: "filename 和 content 不能为空" });
        }
        filename = String(bodyFilename);
        text = typeof content === "string" ? content : JSON.stringify(content);
      }

      if (!text.trim()) {
        return res.status(400).json({ error: "文档内容不能为空" });
      }

      const docId = randomUUID();
      const chunkTexts = splitTextIntoChunks(text);
      const chunks = chunkTexts.map((chunkText, i) => ({
        id: randomUUID(),
        documentId: docId,
        content: chunkText,
        index: i,
      }));

      await store.addDocument(
        { id: docId, userId, title: filename, source: "upload", content: text, createdAt: Date.now() },
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

      const store = swarm.vectorStore;
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

      const store = swarm.vectorStore;
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
          source: existing.source ?? "manual",
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

      const store = swarm.vectorStore;
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

      const store = swarm.vectorStore;
      if (!store) return res.json({ data: [] });

      const results = await store.search(query, topK ?? 5, userId);
      res.json({ data: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
