import { Router } from "express";
import { WorkspaceManager } from "@agent-swarm/core";
import type { AgentSwarm, FileInfo } from "@agent-swarm/core";
import type { ConversationPreferences, ConversationDirectModel } from "@agent-swarm/core";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { deflateRawSync } from "node:zlib";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { resolveRequestUserId } from "../middleware/auth.js";
import {
  createConversationSchema,
  updateConversationPreferencesSchema,
  listConversationsQuerySchema,
} from "../schemas/index.js";

function normalizeEnabledTools(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return Array.from(new Set(normalized));
}

function parseConversationPreferences(input: Record<string, unknown>): Partial<ConversationPreferences> {
  const preferences: Partial<ConversationPreferences> = {};

  if (input.enabledTools) {
    preferences.enabledTools = normalizeEnabledTools(input.enabledTools);
  }
  if (typeof input.thinkingLevel === "string") {
    preferences.thinkingLevel = input.thinkingLevel;
  }
  if (input.directModel) {
    preferences.directModel = input.directModel as ConversationDirectModel;
  }

  return preferences;
}

export function conversationRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", validateQuery(listConversationsQuerySchema), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    const swarmId = req.query.swarmId as string | undefined;
    try {
      const conversations = swarmId
        ? await swarm.listConversations(swarmId, userId)
        : await swarm.listAllConversations(userId);
      res.json({ data: conversations });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", validateBody(createConversationSchema), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    const { swarmId, title } = req.body;
    try {
      const preferences = parseConversationPreferences(req.body as Record<string, unknown>);
      const conversation = await swarm.createConversation(userId, swarmId, title, preferences);
      const conversationInfo = await swarm.getConversation(conversation.getId(), userId);
      if (!conversationInfo) {
        return res.status(500).json({ error: "无法加载已创建的会话" });
      }
      res.json({ data: conversationInfo });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });
      res.json({ data: conversation });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.patch("/:id/preferences", validateBody(updateConversationPreferencesSchema), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const preferences = parseConversationPreferences(req.body as Record<string, unknown>);
      const updated = await swarm.updateConversationPreferences(req.params.id as string, preferences, userId);
      res.json({ data: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/context/clear", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const cleared = await swarm.clearConversationContext(req.params.id as string, userId);
      res.json({ data: cleared });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/:id/workspace/files", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const workspace = new WorkspaceManager(req.params.id as string);
      const [files, metadata] = await Promise.all([
        workspace.listFiles(),
        readArtifactMetadata(workspace),
      ]);
      res.json({
        data: files
          .filter((file) => file.path !== ARTIFACT_METADATA_PATH)
          .map((file) => toArtifactFile(req.params.id as string, file, metadata.finalPaths)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id/workspace/files/content", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const path = typeof req.query.path === "string" ? req.query.path : "";
      if (!path) return res.status(400).json({ error: "path 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      if (path === ARTIFACT_METADATA_PATH) return res.status(404).json({ error: "文件不存在" });
      const result = await workspace.readFile(path, 2000);
      res.json({
        data: {
          path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          ...inferArtifactMeta(path),
        },
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/:id/workspace/files/download", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const path = typeof req.query.path === "string" ? req.query.path : "";
      if (!path) return res.status(400).json({ error: "path 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      if (path === ARTIFACT_METADATA_PATH) return res.status(404).json({ error: "文件不存在" });
      const fullPath = await workspace.checkPath(path);
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) return res.status(400).json({ error: "不是文件" });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(fileStat.size));
      res.setHeader("Content-Disposition", attachmentDisposition(basename(path)));
      const stream = createReadStream(fullPath);
      stream.on("error", (error) => {
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        } else {
          res.destroy(error);
        }
      });
      stream.pipe(res);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/:id/workspace/files/download-zip", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const paths = normalizeArtifactPaths(req.body?.paths);
      if (paths.length === 0) return res.status(400).json({ error: "paths 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      const entries = [];
      for (const path of paths) {
        if (path === ARTIFACT_METADATA_PATH) continue;
        const file = await workspace.readFileBuffer(path);
        entries.push({ path, data: file.data });
      }
      const zip = createZip(entries);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}-artifacts.zip"`);
      res.send(zip);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/:id/workspace/files/import-document", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });
      if (!swarm.vectorStore) return res.status(404).json({ error: "知识库未初始化" });

      const path = typeof req.body?.path === "string" ? req.body.path : "";
      if (!path || path === ARTIFACT_METADATA_PATH) return res.status(400).json({ error: "path 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      const file = await workspace.readFileBuffer(path);
      const text = file.data.toString("utf-8");
      if (!text.trim()) return res.status(400).json({ error: "文件内容为空" });

      const docId = randomUUID();
      const chunks = buildDocumentChunks(docId, text);
      await swarm.vectorStore.addDocument(
        { id: docId, userId, title: basename(path), source: "workspace_artifact", content: text, createdAt: Date.now() },
        chunks,
      );
      res.status(201).json({ data: { id: docId, title: basename(path), chunks: chunks.length } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch("/:id/workspace/files/final", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const path = typeof req.body?.path === "string" ? req.body.path : "";
      const final = req.body?.final === true;
      if (!path || path === ARTIFACT_METADATA_PATH) return res.status(400).json({ error: "path 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      await workspace.readFileBuffer(path);
      const metadata = await readArtifactMetadata(workspace);
      if (final) {
        metadata.finalPaths = Array.from(new Set([...metadata.finalPaths, path]));
      } else {
        metadata.finalPaths = metadata.finalPaths.filter((item) => item !== path);
      }
      await writeArtifactMetadata(workspace, metadata);
      res.json({ data: { path, final } });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/:id/workspace/files", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });

      const path = typeof req.query.path === "string" ? req.query.path : "";
      if (!path || path === ARTIFACT_METADATA_PATH) return res.status(400).json({ error: "path 不能为空" });

      const workspace = new WorkspaceManager(req.params.id as string);
      await workspace.deleteFile(path);
      const metadata = await readArtifactMetadata(workspace);
      if (metadata.finalPaths.includes(path)) {
        metadata.finalPaths = metadata.finalPaths.filter((item) => item !== path);
        await writeArtifactMetadata(workspace, metadata);
      }
      res.json({ data: { deleted: true, path } });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/:id/resume", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.resumeConversation(req.params.id as string, userId);
      res.json({ data: { id: conversation.getId() } });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      await swarm.deleteConversation(req.params.id as string, userId);
      res.json({ data: { deleted: true } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/fork", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const { swarmId, title, messageId } = req.body ?? {};
      const conversation = await swarm.forkConversation(req.params.id as string, { swarmId, title, messageId }, userId);
      const info = await swarm.getConversation(conversation.getId(), userId);
      if (!info) return res.status(500).json({ error: "无法加载已创建的分支会话" });
      res.status(201).json({ data: info });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

interface ArtifactFile {
  path: string;
  name: string;
  size: number;
  kind: string;
  language?: string;
  mimeType: string;
  previewable: boolean;
  createdAt?: number;
  updatedAt?: number;
  downloadUrl: string;
  final: boolean;
}

function toArtifactFile(conversationId: string, file: FileInfo, finalPaths: string[]): ArtifactFile {
  return {
    path: file.path,
    name: basename(file.path),
    size: file.size,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    downloadUrl: `/api/conversations/${encodeURIComponent(conversationId)}/workspace/files/download?path=${encodeURIComponent(file.path)}`,
    final: finalPaths.includes(file.path),
    ...inferArtifactMeta(file.path),
  };
}

interface ArtifactMetadata {
  finalPaths: string[];
}

const ARTIFACT_METADATA_PATH = ".agent-swarm-artifacts.json";

async function readArtifactMetadata(workspace: WorkspaceManager): Promise<ArtifactMetadata> {
  try {
    const result = await workspace.readFile(ARTIFACT_METADATA_PATH);
    const parsed = JSON.parse(result.content) as Partial<ArtifactMetadata>;
    return {
      finalPaths: Array.isArray(parsed.finalPaths)
        ? parsed.finalPaths.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return { finalPaths: [] };
  }
}

async function writeArtifactMetadata(workspace: WorkspaceManager, metadata: ArtifactMetadata): Promise<void> {
  await workspace.writeFile(ARTIFACT_METADATA_PATH, JSON.stringify({
    finalPaths: Array.from(new Set(metadata.finalPaths)).sort(),
  }, null, 2));
}

function normalizeArtifactPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function attachmentDisposition(filename: string): string {
  return `attachment; filename="${escapeHeaderValue(filename)}"; filename*=UTF-8''${encodeHeaderFilename(filename)}`;
}

function encodeHeaderFilename(filename: string): string {
  return encodeURIComponent(filename)
    .replace(/^\./, "%2E")
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildDocumentChunks(documentId: string, text: string) {
  return splitTextIntoChunks(text).map((chunkText, i) => ({
    id: randomUUID(),
    documentId,
    content: chunkText,
    index: i,
  }));
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

function createZip(entries: Array<{ path: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const filename = Buffer.from(entry.path.replace(/^\/+/, ""), "utf-8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function inferArtifactMeta(path: string): Pick<ArtifactFile, "kind" | "language" | "mimeType" | "previewable"> {
  const normalizedPath = path.toLowerCase();
  const filename = normalizedPath.split("/").pop() ?? normalizedPath;
  const extension = filename.split(".").pop() ?? "";
  const namedLanguage = CODE_FILENAMES[filename];
  if (namedLanguage) return { kind: "code", language: namedLanguage, mimeType: "text/plain", previewable: true };
  const language = CODE_EXTENSIONS[extension];
  if (language) return { kind: "code", language, mimeType: "text/plain", previewable: true };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    const mimeType = extension === "jpg" ? "image/jpeg" : `image/${extension === "svg" ? "svg+xml" : extension}`;
    return { kind: "image", mimeType, previewable: true };
  }
  if (["md", "markdown"].includes(extension)) return { kind: "markdown", mimeType: "text/markdown", previewable: true };
  if (extension === "json") return { kind: "json", mimeType: "application/json", previewable: true };
  if (["html", "htm"].includes(extension)) return { kind: "html", mimeType: "text/html", previewable: true };
  if (["txt", "log", "csv", "ts", "tsx", "js", "jsx", "vue", "css", "scss", "jsonl", "xml", "yaml", "yml"].includes(extension)) {
    return { kind: "text", mimeType: "text/plain", previewable: true };
  }
  return { kind: "file", mimeType: "application/octet-stream", previewable: false };
}

const CODE_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "package.json": "json",
  "tsconfig.json": "json",
};

const CODE_EXTENSIONS: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  scala: "scala",
};
