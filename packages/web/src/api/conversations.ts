import { apiClient } from "./client.js";
import type { ConversationInfo } from "../types/index.js";

interface ConversationListResponse {
  data: ConversationInfo[];
}

interface ConversationDetailResponse {
  data: ConversationInfo;
}

export function listConversations(swarmId: string) {
  return apiClient<ConversationListResponse>(`/conversations?swarmId=${swarmId}`);
}

export function createConversation(swarmId: string) {
  return apiClient<ConversationDetailResponse>("/conversations", {
    method: "POST",
    body: JSON.stringify({ swarmId }),
  });
}
