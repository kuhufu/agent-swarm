import { apiClient } from "./client.js";
import type { WorkspaceInfo } from "../types/index.js";

interface WorkspaceListResponse {
  data: WorkspaceInfo[];
}

interface WorkspaceDetailResponse {
  data: WorkspaceInfo;
}

export function listWorkspaces(includeArchived = false) {
  const query = includeArchived ? "?includeArchived=true" : "";
  return apiClient<WorkspaceListResponse>(`/workspaces${query}`);
}

export function createWorkspace(payload: { name: string; description?: string }) {
  return apiClient<WorkspaceDetailResponse>("/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkspace(workspaceId: string, payload: { name?: string; description?: string }) {
  return apiClient<WorkspaceDetailResponse>(`/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function archiveWorkspace(workspaceId: string) {
  return apiClient<WorkspaceDetailResponse>(`/workspaces/${workspaceId}/archive`, {
    method: "POST",
  });
}

export function deleteWorkspace(workspaceId: string) {
  return apiClient<{ data: { success: boolean } }>(`/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
}
