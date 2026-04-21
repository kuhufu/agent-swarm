import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function messageRoutes(_swarm: AgentSwarm) {
  const router = Router();

  // GET /conversations/:id/messages
  router.get("/conversations/:id/messages", async (req, res) => {
    // TODO: implement
    res.json({ data: [] });
  });

  return router;
}
