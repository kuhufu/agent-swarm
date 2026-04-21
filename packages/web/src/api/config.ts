import { apiClient } from "./client.js";
import type { LLMConfig } from "../types/index.js";

interface ConfigResponse {
  data: LLMConfig;
}

export function getConfig() {
  return apiClient<ConfigResponse>("/config");
}

export function updateConfig(config: Partial<LLMConfig>) {
  return apiClient<ConfigResponse>("/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}
