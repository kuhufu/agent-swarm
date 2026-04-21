import express from "express";
import cors from "cors";
import type { AgentSwarm } from "@agent-swarm/core";
import { swarmRoutes } from "./routes/swarms.js";
import { conversationRoutes } from "./routes/conversations.js";
import { messageRoutes } from "./routes/messages.js";
import { configRoutes } from "./routes/config.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(swarm: AgentSwarm) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Routes
  app.use("/api/swarms", swarmRoutes(swarm));
  app.use("/api/conversations", conversationRoutes(swarm));
  app.use("/api/config", configRoutes(swarm));
  app.use("/api", messageRoutes(swarm));

  // Error handler
  app.use(errorHandler);

  return app;
}
