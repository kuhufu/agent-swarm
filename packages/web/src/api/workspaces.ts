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
