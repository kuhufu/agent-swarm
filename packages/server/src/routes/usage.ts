import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { resolveRequestUserId } from "../middleware/auth.js";

export function usageRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/conversations/:id/usage", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const conversation = await swarm.getConversation(req.params.id as string, userId);
      if (!conversation) return res.status(404).json({ error: "会话不存在" });
      const usage = await swarm.getConversationUsage(req.params.id as string, userId);
      res.json({ data: usage });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/usage/daily", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const usage = await swarm.getDailyUsage(userId, days);
      res.json({ data: usage });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/llm/calls", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const { conversationId, providerId, modelId, days, limit } = req.query as Record<string, string | undefined>;
      const calls = await swarm.queryLLMCalls({
        conversationId,
        providerId,
        modelId,
        days: days ? parseInt(days, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      }, userId);
      res.json({ data: calls });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
