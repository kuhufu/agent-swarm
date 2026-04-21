import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function swarmRoutes(swarm: AgentSwarm) {
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

  // POST/PUT/DELETE will be implemented with storage layer

  return router;
}
