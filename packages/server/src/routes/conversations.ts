import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function conversationRoutes(swarm: AgentSwarm) {
  const router = Router();

  router.get("/", async (req, res) => {
    const swarmId = req.query.swarmId as string | undefined;
    if (!swarmId) {
      return res.status(400).json({ error: "swarmId query parameter required" });
    }
    const conversations = await swarm.listConversations(swarmId);
    res.json({ data: conversations });
  });

  router.post("/", async (req, res) => {
    const { swarmId } = req.body;
    if (!swarmId) {
      return res.status(400).json({ error: "swarmId required" });
    }
    try {
      const conversation = await swarm.createConversation(swarmId);
      res.json({ data: conversation });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /:id, DELETE /:id, POST /:id/resume will be implemented

  return router;
}
