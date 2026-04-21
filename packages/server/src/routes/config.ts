import { Router } from "express";
import type { AgentSwarm, LLMBackendConfig } from "@agent-swarm/core";

function maskApiKeys(apiKeys: Record<string, string>): Record<string, string> {
  const maskedApiKeys: Record<string, string> = {};

  for (const [provider, key] of Object.entries(apiKeys)) {
    if (!key) continue;

    if (key.length > 12) {
      maskedApiKeys[provider] = key.substring(0, 8) + "..." + key.substring(key.length - 4);
    } else {
      maskedApiKeys[provider] = key.substring(0, 4) + "...";
    }
  }

  return maskedApiKeys;
}

function toResponse(config: LLMBackendConfig) {
  return {
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    apiKeys: maskApiKeys(config.apiKeys),
    providers: config.providers,
    endpoints: config.endpoints,
    defaultThinkingLevel: config.defaultThinkingLevel,
    defaultThinkingBudgets: config.defaultThinkingBudgets,
    models: config.models,
  };
}

export function configRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const config = swarm.getLLMConfig();
    res.json({ data: toResponse(config) });
  });

  router.put("/", async (req, res) => {
    try {
      const {
        defaultProvider,
        defaultModel,
        apiKeys,
        providers,
        endpoints,
        defaultThinkingLevel,
        defaultThinkingBudgets,
        models,
      } = req.body;

      const currentConfig = swarm.getLLMConfig();

      const mergedApiKeys: Record<string, string> = { ...currentConfig.apiKeys };
      if (apiKeys && typeof apiKeys === "object") {
        for (const [provider, key] of Object.entries(apiKeys as Record<string, unknown>)) {
          if (typeof key !== "string") continue;
          if (key.includes("...") && currentConfig.apiKeys[provider]) continue;
          mergedApiKeys[provider] = key;
        }
      }

      const nextConfig: LLMBackendConfig = {
        ...currentConfig,
        defaultProvider: defaultProvider ?? currentConfig.defaultProvider,
        defaultModel: defaultModel ?? currentConfig.defaultModel,
        apiKeys: mergedApiKeys,
        providers: providers ?? currentConfig.providers,
        endpoints: endpoints ?? currentConfig.endpoints,
        defaultThinkingLevel: defaultThinkingLevel ?? currentConfig.defaultThinkingLevel,
        defaultThinkingBudgets: defaultThinkingBudgets ?? currentConfig.defaultThinkingBudgets,
        models: models ?? currentConfig.models,
      };

      const updatedConfig = await swarm.updateLLMConfig(nextConfig);
      res.json({ data: toResponse(updatedConfig) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
