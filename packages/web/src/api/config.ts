import { apiClient } from "./client.js";
import type { LLMConfig, ModelTestRequest, ModelTestResult } from "../types/index.js";

interface ConfigResponse {
  data: LLMConfig;
}

interface ModelTestResponse {
  data: ModelTestResult;
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

export function testModelConnection(payload: ModelTestRequest) {
  return apiClient<ModelTestResponse>("/config/test-model", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
