import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { resolveRequestUserId } from "../middleware/auth.js";

export function messageRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/conversations/:id/messages", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const since = req.query.since ? Number(req.query.since) : undefined;
      if (since !== undefined && (Number.isNaN(since) || since < 0)) {
        return res.status(400).json({ error: "Invalid since parameter" });
      }
      const messages = await swarm.getMessages(req.params.id as string, userId, since);
      res.json({ data: messages });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}
