import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function configRoutes(_swarm: AgentSwarm) {
  const router = Router();

  router.get("/", (_req, res) => {
    // TODO: return LLM config (without API keys)
    res.json({ data: {} });
  });

  router.put("/", (req, res) => {
    // TODO: update LLM config
    res.json({ data: req.body });
  });

  return router;
}
