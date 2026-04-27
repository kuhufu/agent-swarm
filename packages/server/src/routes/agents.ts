import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { validateBody } from "../middleware/validate.js";
import { createAgentPresetSchema, updateAgentPresetSchema } from "../schemas/index.js";

export function agentRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const presets = await swarm.listAgentPresets();
      res.json({ data: presets });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to list agent presets" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const preset = await swarm.getAgentPreset(req.params.id as string);
      if (!preset) return res.status(404).json({ error: "Agent 预设不存在" });
      res.json({ data: preset });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to get agent preset" });
    }
  });

  router.post("/", validateBody(createAgentPresetSchema), async (req, res) => {
    try {
      const input = req.body;
      const preset = {
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        systemPrompt: input.systemPrompt ?? "",
        model: input.model ?? { provider: "", modelId: "" },
        category: input.category ?? "",
        tags: input.tags ?? [],
        builtIn: false,
      };
      const created = await swarm.addAgentPreset(preset);
      res.status(201).json({ data: created });
    } catch (err: any) {
      const message = err?.message ?? "创建 Agent 预设失败";
      const status = message.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.put("/:id", validateBody(updateAgentPresetSchema), async (req, res) => {
    try {
      const id = req.params.id as string;
      const existing = await swarm.getAgentPreset(id);
      if (!existing) return res.status(404).json({ error: "Agent 预设不存在" });

      const input = req.body;
      const preset = {
        id,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        systemPrompt: input.systemPrompt ?? existing.systemPrompt,
        model: input.model ? {
          provider: input.model.provider ?? existing.model.provider,
          modelId: input.model.modelId ?? existing.model.modelId,
        } : existing.model,
        category: input.category ?? existing.category,
        tags: input.tags ?? existing.tags,
        builtIn: existing.builtIn,
      };
      const updated = await swarm.updateAgentPreset(id, preset);
      res.json({ data: updated });
    } catch (err: any) {
      const message = err?.message ?? "更新 Agent 预设失败";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await swarm.deleteAgentPreset(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      const message = err?.message ?? "Failed to delete agent preset";
      const status = message.includes("not found") ? 404 : message.includes("read-only") ? 403 : 400;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
