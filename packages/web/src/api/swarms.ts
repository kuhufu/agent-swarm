import { apiClient } from "./client.js";
import type { SwarmConfig } from "../types/index.js";

interface SwarmListResponse {
  data: SwarmConfig[];
}

interface SwarmDetailResponse {
  data: SwarmConfig;
}

export function listSwarms() {
  return apiClient<SwarmListResponse>("/swarms");
}

export function getSwarm(id: string) {
  return apiClient<SwarmDetailResponse>(`/swarms/${id}`);
}

export function createSwarm(swarm: Omit<SwarmConfig, "agents"> & { agents: SwarmConfig["agents"] }) {
  return apiClient<SwarmDetailResponse>("/swarms", {
    method: "POST",
    body: JSON.stringify(swarm),
  });
}
