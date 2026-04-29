import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { validateBody } from "../middleware/validate.js";
import { requireAdmin } from "../middleware/auth.js";
import { createAgentTemplateSchema, updateAgentTemplateSchema } from "../schemas/index.js";

export function templateRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const templates = await swarm.listAgentTemplates();
      res.json({ data: templates });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "获取模板列表失败" });
    }
  });

  router.post("/", requireAdmin, validateBody(createAgentTemplateSchema), async (req, res) => {
    try {
      const input = req.body;
      const template = {
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        systemPrompt: input.systemPrompt ?? "",
        model: input.model ?? { provider: "", modelId: "" },
        category: input.category ?? "",
        tags: input.tags ?? [],
        builtIn: true,
      };
      const created = await swarm.addAgentTemplate(template);
      res.status(201).json({ data: created });
    } catch (err: any) {
      const message = err?.message ?? "创建模板失败";
      const status = message.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.put("/:id", requireAdmin, validateBody(updateAgentTemplateSchema), async (req, res) => {
    try {
      const id = req.params.id as string;
      const existing = await swarm.listAgentTemplates().then(
        (templates) => templates.find((t) => t.id === id),
      );
      if (!existing) return res.status(404).json({ error: "模板不存在" });

      const input = req.body;
      const template = {
        id,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        systemPrompt: input.systemPrompt ?? existing.systemPrompt,
        model: input.model
          ? {
              provider: input.model.provider ?? existing.model.provider,
              modelId: input.model.modelId ?? existing.model.modelId,
            }
          : existing.model,
        category: input.category ?? existing.category,
        tags: input.tags ?? existing.tags,
        builtIn: true,
      };
      const updated = await swarm.updateAgentTemplate(id, template);
      res.json({ data: updated });
    } catch (err: any) {
      const message = err?.message ?? "更新模板失败";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.delete("/:id", requireAdmin, async (req, res) => {
    try {
      await swarm.deleteAgentTemplate(req.params.id as string);
      res.json({ success: true });
    } catch (err: any) {
      const message = err?.message ?? "删除模板失败";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
