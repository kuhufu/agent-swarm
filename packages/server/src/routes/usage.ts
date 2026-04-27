import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function usageRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/conversations/:id/usage", async (req, res) => {
    try {
      const usage = await swarm.getConversationUsage(req.params.id as string);
      res.json({ data: usage });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/usage/daily", async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const usage = await swarm.getDailyUsage(days);
      res.json({ data: usage });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
