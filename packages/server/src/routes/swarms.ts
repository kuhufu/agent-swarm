import { Router } from "express";
import type { AgentSwarm, SwarmConfig, CollaborationMode } from "@agent-swarm/core";
import { randomUUID } from "node:crypto";
import { validateBody } from "../middleware/validate.js";
import { createSwarmSchema, updateSwarmSchema } from "../schemas/index.js";

function normalizeMode(mode: unknown): CollaborationMode {
  if (typeof mode === "string") return mode as CollaborationMode;
  if (mode && typeof mode === "object" && "type" in mode) {
    return (mode as Record<string, unknown>).type as CollaborationMode;
  }
  return "router";
}

function buildSwarmConfig(input: Record<string, unknown>, options: { idOverride?: string; autoGenerateId?: boolean } = {}): SwarmConfig {
  const fromInput = typeof input.id === "string" ? input.id.trim() : "";
  const resolvedId = options.idOverride ?? (fromInput || (options.autoGenerateId ? `swarm-${randomUUID()}` : ""));

  const config: SwarmConfig = {
    id: resolvedId,
    name: input.name as string,
    mode: normalizeMode(input.mode),
    agents: input.agents as SwarmConfig["agents"],
    orchestrator: input.orchestrator as SwarmConfig["orchestrator"],
    aggregator: input.aggregator as SwarmConfig["aggregator"],
    debateConfig: input.debateConfig as SwarmConfig["debateConfig"],
    pipeline: input.pipeline as SwarmConfig["pipeline"],
    interventions: input.interventions as SwarmConfig["interventions"],
    maxTotalTurns: input.maxTotalTurns as number | undefined,
    maxConcurrency: input.maxConcurrency as number | undefined,
  };

  if (config.mode === "router" && !config.orchestrator) {
    config.orchestrator = config.agents[0];
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
    const id = req.params.id as string;
    const config = swarm.getSwarmConfig(id);
    if (!config) return res.status(404).json({ error: "Swarm 不存在" });
    res.json({ data: config });
  });

  router.post("/", validateBody(createSwarmSchema), async (req, res) => {
    try {
      const config = await swarm.addSwarmConfig(buildSwarmConfig(req.body as Record<string, unknown>, { autoGenerateId: true }));
      res.status(201).json({ data: config });
    } catch (err: any) {
      const message = err?.message ?? "创建 Swarm 失败";
      const status = message.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.put("/:id", validateBody(updateSwarmSchema), async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!id) return res.status(400).json({ error: "缺少 Swarm ID" });
      const existing = swarm.getSwarmConfig(id);
      if (!existing) return res.status(404).json({ error: "Swarm 不存在" });

      const body = req.body as Record<string, unknown>;
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
      const message = err?.message ?? "更新 Swarm 失败";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await swarm.deleteSwarmConfig(req.params.id as string);
      res.json({ success: true });
    } catch (err: any) {
      const message = err?.message ?? "删除 Swarm 失败";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
