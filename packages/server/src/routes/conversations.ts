import { Router } from "express";
import { WorkspaceManager } from "@agent-swarm/core";
import type { AgentSwarm, FileInfo } from "@agent-swarm/core";
import type { ConversationPreferences, ConversationDirectModel } from "@agent-swarm/core";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
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
      const files = await workspace.listFiles();
      res.json({ data: files.map((file) => toArtifactFile(req.params.id as string, file)) });
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
      const fullPath = await workspace.checkPath(path);
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) return res.status(400).json({ error: "不是文件" });
      res.download(fullPath, basename(path));
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
}

function toArtifactFile(conversationId: string, file: FileInfo): ArtifactFile {
  return {
    path: file.path,
    name: basename(file.path),
    size: file.size,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    downloadUrl: `/api/conversations/${encodeURIComponent(conversationId)}/workspace/files/download?path=${encodeURIComponent(file.path)}`,
    ...inferArtifactMeta(file.path),
  };
}

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
