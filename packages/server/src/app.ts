import express from "express";
import cors from "cors";
import type { AgentSwarm } from "@agent-swarm/core";
import type { Express } from "express";
import type { SwarmConversation } from "@agent-swarm/core";
import { swarmRoutes } from "./routes/swarms.js";
import { agentRoutes } from "./routes/agents.js";
import { conversationRoutes } from "./routes/conversations.js";
import { messageRoutes } from "./routes/messages.js";
import { configRoutes } from "./routes/config.js";
import { usageRoutes } from "./routes/usage.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(swarm: AgentSwarm): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Routes
  app.use("/api/swarms", swarmRoutes(swarm));
  app.use("/api/agents", agentRoutes(swarm));
  app.use("/api/conversations", conversationRoutes(swarm));
  app.use("/api/config", configRoutes(swarm));
  app.use("/api", messageRoutes(swarm));
  app.use("/api", usageRoutes(swarm));

  // Error handler
  app.use(errorHandler);

  return app;
}

// Re-export for ws.ts
export type { SwarmConversation as Conversation };
