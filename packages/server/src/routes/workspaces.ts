import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";
import { validateBody } from "../middleware/validate.js";
import { resolveRequestUserId } from "../middleware/auth.js";
import { createWorkspaceSchema, updateWorkspaceSchema } from "../schemas/index.js";

export function workspaceRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const includeArchived = req.query.includeArchived === "true";
      const workspaces = await swarm.listWorkspaces(userId, { includeArchived });
      res.json({ data: workspaces });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", validateBody(createWorkspaceSchema), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const workspace = await swarm.createWorkspace(userId, {
        name: req.body.name,
        description: req.body.description,
      });
      res.json({ data: workspace });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const workspace = await swarm.getWorkspace(req.params.id as string, userId);
      if (!workspace) return res.status(404).json({ error: "工作区不存在" });
      res.json({ data: workspace });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.patch("/:id", validateBody(updateWorkspaceSchema), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const workspace = await swarm.updateWorkspace(req.params.id as string, userId, {
        name: req.body.name,
        description: req.body.description,
      });
      res.json({ data: workspace });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/archive", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      const workspace = await swarm.archiveWorkspace(req.params.id as string, userId);
      res.json({ data: workspace });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: "未登录" });

    try {
      await swarm.deleteWorkspace(req.params.id as string, userId);
      res.json({ data: { success: true } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
