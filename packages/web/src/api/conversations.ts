import { apiClient } from "./client.js";
import type { ConversationInfo, ChatMessage } from "../types/index.js";

interface ConversationListResponse {
  data: ConversationInfo[];
}

interface ConversationDetailResponse {
  data: ConversationInfo;
}

interface MessageListResponse {
  data: ChatMessage[];
}

interface DeleteConversationResponse {
  data: {
    deleted: boolean;
  };
}

export function listConversations(swarmId?: string) {
  const query = swarmId ? `?swarmId=${swarmId}` : "";
  return apiClient<ConversationListResponse>(`/conversations${query}`);
}

export function createConversation(swarmId: string) {
  return apiClient<ConversationDetailResponse>("/conversations", {
    method: "POST",
    body: JSON.stringify({ swarmId }),
  });
}

export function getConversation(conversationId: string) {
  return apiClient<ConversationDetailResponse>(`/conversations/${conversationId}`);
}

export function updateConversationPreferences(
  conversationId: string,
  payload: Partial<Pick<ConversationInfo, "enabledTools" | "thinkModeEnabled" | "directModel">>,
) {
  return apiClient<ConversationDetailResponse>(`/conversations/${conversationId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getMessages(conversationId: string) {
  return apiClient<MessageListResponse>(`/conversations/${conversationId}/messages`);
}

export function deleteConversation(conversationId: string) {
  return apiClient<DeleteConversationResponse>(`/conversations/${conversationId}`, {
    method: "DELETE",
  });
}
