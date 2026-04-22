import { Router } from "express";
import type { AgentSwarm, LLMBackendConfig, ApiProtocol } from "@agent-swarm/core";

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
  const apiKeys = config.apiKeys && typeof config.apiKeys === "object" ? config.apiKeys : {};
  return {
    apiKeys: maskApiKeys(apiKeys),
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
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const {
        apiKeys,
        providers,
        endpoints,
        defaultThinkingLevel,
        defaultThinkingBudgets,
        models,
      } = req.body;

      const currentConfig = swarm.getLLMConfig();
      const currentApiKeys = currentConfig.apiKeys && typeof currentConfig.apiKeys === "object"
        ? currentConfig.apiKeys
        : {};
      const currentProviders = currentConfig.providers && typeof currentConfig.providers === "object"
        ? currentConfig.providers
        : undefined;
      const currentEndpoints = currentConfig.endpoints && typeof currentConfig.endpoints === "object"
        ? currentConfig.endpoints
        : undefined;
      const currentModels = Array.isArray(currentConfig.models) ? currentConfig.models : undefined;

      const nextApiKeys: Record<string, string> = (() => {
        if (!apiKeys || typeof apiKeys !== "object") {
          return { ...currentApiKeys };
        }

        const replaced: Record<string, string> = {};
        for (const [provider, key] of Object.entries(apiKeys as Record<string, unknown>)) {
          if (typeof key !== "string") continue;
          if (key.includes("...") && currentApiKeys[provider]) {
            replaced[provider] = currentApiKeys[provider];
            continue;
          }
          replaced[provider] = key;
        }
        return replaced;
      })();

      const nextConfig: LLMBackendConfig = {
        ...currentConfig,
        apiKeys: nextApiKeys,
        providers: providers ?? currentProviders,
        endpoints: endpoints ?? currentEndpoints,
        defaultThinkingLevel: defaultThinkingLevel ?? currentConfig.defaultThinkingLevel,
        defaultThinkingBudgets: defaultThinkingBudgets ?? currentConfig.defaultThinkingBudgets,
        models: models ?? currentModels,
      };

      const updatedConfig = await swarm.updateLLMConfig(nextConfig);
      res.json({ data: toResponse(updatedConfig) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/test-model", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const body = req.body as Record<string, unknown>;
      const provider = typeof body.provider === "string" ? body.provider.trim() : "";
      const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
      if (!provider || !modelId) {
        return res.status(400).json({ error: "provider and modelId are required" });
      }

      const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
      const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;
      const override = (
        body.override
        && typeof body.override === "object"
        && !Array.isArray(body.override)
      )
        ? body.override as Record<string, unknown>
        : undefined;
      const currentConfig = swarm.getLLMConfig();
      const currentApiKey = currentConfig.apiKeys?.[provider];

      const overrideApiKey = (() => {
        if (!override || typeof override.apiKey !== "string") {
          return undefined;
        }
        const key = override.apiKey.trim();
        if (!key) {
          return "";
        }
        // 脱敏 key（如 sk-xxxx...yyyy）不应覆盖真实 key。
        if (key.includes("...") && currentApiKey) {
          return currentApiKey;
        }
        return key;
      })();

      const result = await swarm.testModelConnection({
        provider,
        modelId,
        prompt,
        timeoutMs,
        override: override
          ? {
            ...(overrideApiKey !== undefined ? { apiKey: overrideApiKey } : {}),
            ...(typeof override.baseUrl === "string" ? { baseUrl: override.baseUrl } : {}),
            ...(typeof override.apiProtocol === "string" ? { apiProtocol: override.apiProtocol as ApiProtocol } : {}),
          }
          : undefined,
      });

      res.json({ data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Model connection test failed" });
    }
  });

  return router;
}
