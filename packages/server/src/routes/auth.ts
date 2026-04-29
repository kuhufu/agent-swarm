import { Router } from "express";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import type { AgentSwarm } from "@agent-swarm/core";
import { signToken } from "../middleware/auth.js";

export function authRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ error: "用户名和密码不能为空" });
      }
      if (typeof username !== "string" || username.trim().length < 2) {
        return res.status(400).json({ error: "用户名至少 2 个字符" });
      }
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "密码至少 6 个字符" });
      }

      const existing = await swarm.getUserByUsername(username.trim());
      if (existing) {
        return res.status(409).json({ error: "用户名已存在" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const role: "admin" | "user" = await swarm.countUsers() === 0 ? "admin" : "user";
      const user = {
        id: randomUUID(),
        username: username.trim(),
        passwordHash,
        role,
        createdAt: Date.now(),
      };

      await swarm.createUser(user);

      const token = signToken({ id: user.id, username: user.username, role: user.role });
      res.status(201).json({
        data: { token, user: { id: user.id, username: user.username, role: user.role } },
      });
    } catch (err: any) {
      if (err?.message?.includes("UNIQUE constraint")) {
        return res.status(409).json({ error: "用户名已存在" });
      }
      res.status(500).json({ error: "注册失败" });
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ error: "用户名和密码不能为空" });
      }

      const user = await swarm.getUserByUsername(username.trim());
      if (!user) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      const token = signToken({ id: user.id, username: user.username, role: user.role });
      res.json({
        data: { token, user: { id: user.id, username: user.username, role: user.role } },
      });
    } catch {
      res.status(500).json({ error: "登录失败" });
    }
  });

  router.get("/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "未登录" });
    }
    res.json({ data: { id: req.user.id, username: req.user.username, role: req.user.role } });
  });

  router.post("/logout", (_req, res) => {
    // JWT is stateless; client clears token locally.
    res.json({ data: { loggedOut: true } });
  });

  return router;
}
