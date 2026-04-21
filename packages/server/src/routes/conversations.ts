import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

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
    const { swarmId, title } = req.body;
    if (!swarmId) {
      return res.status(400).json({ error: "swarmId required" });
    }
    try {
      const conversation = await swarm.createConversation(swarmId, title);
      res.json({ data: { id: conversation.getId() } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const messages = await swarm.getMessages(req.params.id);
      res.json({ data: messages });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
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
