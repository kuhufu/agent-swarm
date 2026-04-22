import { Router } from "express";
import type { AgentSwarm, SwarmConfig } from "@agent-swarm/core";
import { randomUUID } from "node:crypto";

interface BuildSwarmConfigOptions {
  idOverride?: string;
  autoGenerateId?: boolean;
}

function buildSwarmConfig(input: any, options: BuildSwarmConfigOptions = {}): SwarmConfig {
  const incomingId = typeof input.id === "string" ? input.id.trim() : "";
  const resolvedId = options.idOverride
    ?? (incomingId || (options.autoGenerateId ? `swarm-${randomUUID()}` : ""));

  const config: SwarmConfig = {
    id: resolvedId,
    name: input.name,
    mode: input.mode,
    agents: input.agents,
    orchestrator: input.orchestrator,
    aggregator: input.aggregator,
    debateConfig: input.debateConfig,
    pipeline: input.pipeline,
    interventions: input.interventions,
    maxTotalTurns: input.maxTotalTurns,
    maxConcurrency: input.maxConcurrency,
  };

  if (config.mode === "router" && !config.orchestrator && Array.isArray(config.agents) && config.agents.length > 0) {
    config.orchestrator = config.agents[0];
  }

  if (!config.id || !config.name || !config.mode || !Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error("id, name, mode, and at least one agent are required");
  }
  if (config.mode === "router" && !config.orchestrator) {
    throw new Error("orchestrator is required for router mode");
  }
  if (config.mode === "debate" && !config.debateConfig) {
    config.debateConfig = {
      rounds: 3,
      proAgent: config.agents[0]?.id ?? "",
      conAgent: config.agents[1]?.id ?? config.agents[0]?.id ?? "",
      judgeAgent: config.agents[0]?.id ?? "",
    };
  }

  return config;
}

export function swarmRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    // Hide virtual direct-chat swarms from swarm management.
    const swarms = swarm.listSwarms().filter((item) => !item.id.startsWith("__direct_"));
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
      const config = await swarm.addSwarmConfig(buildSwarmConfig(req.body, { autoGenerateId: true }));
      res.status(201).json({ data: config });
    } catch (err: any) {
      const message = err?.message ?? "Failed to create swarm";
      const status = message.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const existing = swarm.getSwarmConfig(id);
      if (!existing) {
        return res.status(404).json({ error: "Swarm not found" });
      }

      const body = req.body ?? {};
      const mergedInput = {
        ...existing,
        ...body,
        id,
        agents: body.agents ?? existing.agents,
        orchestrator: body.orchestrator ?? existing.orchestrator,
        aggregator: body.aggregator ?? existing.aggregator,
        debateConfig: body.debateConfig ?? existing.debateConfig,
        pipeline: body.pipeline ?? existing.pipeline,
        interventions: body.interventions ?? existing.interventions,
        maxTotalTurns: body.maxTotalTurns ?? existing.maxTotalTurns,
        maxConcurrency: body.maxConcurrency ?? existing.maxConcurrency,
      };

      const config = await swarm.updateSwarmConfig(id, buildSwarmConfig(mergedInput, { idOverride: id }));
      res.json({ data: config });
    } catch (err: any) {
      const message = err?.message ?? "Failed to update swarm";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await swarm.deleteSwarmConfig(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      const message = err?.message ?? "Failed to delete swarm";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
