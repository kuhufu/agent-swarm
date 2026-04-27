import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function messageRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/conversations/:id/messages", async (req, res) => {
    try {
      const messages = await swarm.getMessages(req.params.id as string);
      res.json({ data: messages });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}
