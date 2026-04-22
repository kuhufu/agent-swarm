import { apiClient } from "./client.js";
import type { LLMConfig, ModelTestRequest, ModelTestResult, ProviderInfo, ModelInfo } from "../types/index.js";

interface ConfigResponse {
  data: LLMConfig;
}

interface ModelTestResponse {
  data: ModelTestResult;
}

interface ProvidersResponse {
  data: ProviderInfo[];
}

interface ModelsResponse {
  data: ModelInfo[];
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

export function listProviders() {
  return apiClient<ProvidersResponse>("/config/providers");
}

export function listModels(providerId: string) {
  return apiClient<ModelsResponse>(`/config/providers/${encodeURIComponent(providerId)}/models`);
}

export function testModelConnection(payload: ModelTestRequest) {
  return apiClient<ModelTestResponse>("/config/test-model", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
