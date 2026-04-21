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

export function listConversations(swarmId: string) {
  return apiClient<ConversationListResponse>(`/conversations?swarmId=${swarmId}`);
}

export function createConversation(swarmId: string) {
  return apiClient<ConversationDetailResponse>("/conversations", {
    method: "POST",
    body: JSON.stringify({ swarmId }),
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
