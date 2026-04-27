import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import type { ConversationPreferences, ConversationDirectModel } from "@agent-swarm/core";
import { validateBody, validateQuery } from "../middleware/validate.js";
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
    const swarmId = req.query.swarmId as string | undefined;
    try {
      const conversations = swarmId
        ? await swarm.listConversations(swarmId)
        : await swarm.listAllConversations();
      res.json({ data: conversations });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", validateBody(createConversationSchema), async (req, res) => {
    const { swarmId, title } = req.body;
    try {
      const preferences = parseConversationPreferences(req.body as Record<string, unknown>);
      const conversation = await swarm.createConversation(swarmId, title, preferences);
      const conversationInfo = await swarm.getConversation(conversation.getId());
      if (!conversationInfo) {
        return res.status(500).json({ error: "无法加载已创建的会话" });
      }
      res.json({ data: conversationInfo });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const conversation = await swarm.getConversation(req.params.id as string);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });
      res.json({ data: conversation });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.patch("/:id/preferences", validateBody(updateConversationPreferencesSchema), async (req, res) => {
    try {
      const preferences = parseConversationPreferences(req.body as Record<string, unknown>);
      const updated = await swarm.updateConversationPreferences(req.params.id as string, preferences);
      res.json({ data: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/context/clear", async (req, res) => {
    try {
      const cleared = await swarm.clearConversationContext(req.params.id as string);
      res.json({ data: cleared });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/:id/resume", async (req, res) => {
    try {
      const conversation = await swarm.resumeConversation(req.params.id as string);
      res.json({ data: { id: conversation.getId() } });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await swarm.deleteConversation(req.params.id as string);
      res.json({ data: { deleted: true } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
