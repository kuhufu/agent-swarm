import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import type { ConversationPreferences } from "@agent-swarm/core";

function normalizeEnabledTools(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = input
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return Array.from(new Set(normalized));
}

function parseConversationPreferences(input: unknown): Partial<ConversationPreferences> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const preferences: Partial<ConversationPreferences> = {};

  if (Array.isArray(raw.enabledTools)) {
    preferences.enabledTools = normalizeEnabledTools(raw.enabledTools);
  }
  if (typeof raw.thinkModeEnabled === "boolean") {
    preferences.thinkModeEnabled = raw.thinkModeEnabled;
  }

  return preferences;
}

export function conversationRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const swarmId = req.query.swarmId as string | undefined;
    if (!swarmId) {
      return res.status(400).json({ error: "swarmId query parameter required" });
    }
    try {
      const conversations = await swarm.listConversations(swarmId);
      res.json({ data: conversations });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", async (req, res) => {
    const { swarmId, title } = req.body ?? {};
    if (!swarmId) {
      return res.status(400).json({ error: "swarmId required" });
    }
    try {
      const preferences = parseConversationPreferences(req.body);
      const conversation = await swarm.createConversation(swarmId, title, preferences);
      const conversationInfo = await swarm.getConversation(conversation.getId());
      if (!conversationInfo) {
        return res.status(500).json({ error: "Failed to load created conversation" });
      }
      res.json({ data: conversationInfo });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const conversation = await swarm.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      res.json({ data: conversation });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.patch("/:id/preferences", async (req, res) => {
    try {
      const preferences = parseConversationPreferences(req.body);
      const updated = await swarm.updateConversationPreferences(req.params.id, preferences);
      res.json({ data: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/resume", async (req, res) => {
    try {
      const conversation = await swarm.resumeConversation(req.params.id);
      res.json({ data: { id: conversation.getId() } });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await swarm.deleteConversation(req.params.id);
      res.json({ data: { deleted: true } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
