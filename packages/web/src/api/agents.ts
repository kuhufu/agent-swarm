import { apiClient } from "./client.js";
import type { PresetAgent } from "../types/index.js";

interface AgentListResponse {
  data: { presets: PresetAgent[]; templates: PresetAgent[] };
}

interface AgentDetailResponse {
  data: PresetAgent;
}

interface DeleteAgentResponse {
  success: boolean;
}

export interface CreatePresetAgentPayload {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  model?: {
    provider?: string;
    modelId?: string;
  };
  category?: string;
  tags?: string[];
}

export interface UpdatePresetAgentPayload {
  name?: string;
  description?: string;
  systemPrompt?: string;
  model?: {
    provider?: string;
    modelId?: string;
  };
  category?: string;
  tags?: string[];
}

export function listAgents() {
  return apiClient<AgentListResponse>("/agents");
}

export function getAgent(id: string) {
  return apiClient<AgentDetailResponse>(`/agents/${id}`);
}

export function createAgent(payload: CreatePresetAgentPayload) {
  return apiClient<AgentDetailResponse>("/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAgent(id: string, payload: UpdatePresetAgentPayload) {
  return apiClient<AgentDetailResponse>(`/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteAgent(id: string) {
  return apiClient<DeleteAgentResponse>(`/agents/${id}`, {
    method: "DELETE",
  });
}

export function importTemplate(templateId: string) {
  return apiClient<AgentDetailResponse>(`/agents/import-template/${templateId}`, {
    method: "POST",
  });
}

export function listTemplates() {
  return apiClient<{ data: PresetAgent[] }>("/templates");
}

export function createTemplate(payload: CreatePresetAgentPayload) {
  return apiClient<AgentDetailResponse>("/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTemplate(id: string, payload: UpdatePresetAgentPayload) {
  return apiClient<AgentDetailResponse>(`/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteTemplate(id: string) {
  return apiClient<DeleteAgentResponse>(`/templates/${id}`, {
    method: "DELETE",
  });
}
