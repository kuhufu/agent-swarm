import { Router } from "express";
import type { AgentSwarm } from "@agent-swarm/core";

export function configRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const config = swarm.getLLMConfig();
    // Mask API keys for security
    const maskedApiKeys: Record<string, string> = {};
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      if (key && key.length > 12) {
        maskedApiKeys[provider] = key.substring(0, 8) + "..." + key.substring(key.length - 4);
      } else if (key) {
        maskedApiKeys[provider] = key.substring(0, 4) + "...";
      }
    }
    res.json({
      data: {
        defaultProvider: config.defaultProvider,
        defaultModel: config.defaultModel,
        apiKeys: maskedApiKeys,
        endpoints: config.endpoints,
        defaultThinkingLevel: config.defaultThinkingLevel,
      },
    });
  });

  router.put("/", (req, res) => {
    try {
      const { defaultProvider, defaultModel } = req.body;
      const currentConfig = swarm.getLLMConfig();

      res.json({
        data: {
          defaultProvider: defaultProvider ?? currentConfig.defaultProvider,
          defaultModel: defaultModel ?? currentConfig.defaultModel,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
