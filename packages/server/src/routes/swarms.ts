import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function swarmRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const swarms = swarm.listSwarms();
    res.json({ data: swarms });
  });

  router.get("/:id", (req, res) => {
    const config = swarm.getSwarmConfig(req.params.id);
    if (!config) {
      return res.status(404).json({ error: "Swarm not found" });
    }
    res.json({ data: config });
  });

  router.post("/", async (req, res) => {
    try {
      const { id, name, mode, agents } = req.body;
      if (!id || !name || !mode || !agents?.length) {
        return res.status(400).json({ error: "id, name, mode, and at least one agent are required" });
      }
      const config = await swarm.addSwarmConfig({ id, name, mode, agents });
      res.status(201).json({ data: config });
    } catch (err: any) {
      const message = err?.message ?? "Failed to create swarm";
      const status = message.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
