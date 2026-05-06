import { apiClient } from "./client.js";
import type { ConversationInfo, ChatMessage, ConversationEvent } from "../types/index.js";

interface ConversationListResponse {
  data: ConversationInfo[];
}

interface ConversationDetailResponse {
  data: ConversationInfo;
}

interface MessageListResponse {
  data: ChatMessage[];
}

interface EventListResponse {
  data: ConversationEvent[];
}

interface DeleteConversationResponse {
  data: {
    deleted: boolean;
  };
}

interface ClearConversationContextResponse {
  data: {
    conversationId: string;
    contextResetAt: number;
    markerMessage: {
      id: string;
      agentId?: string | null;
      role: string;
      content?: string | null;
      thinking?: string | null;
      toolCalls?: string | null;
      toolCallId?: string | null;
      metadata?: string | null;
      timestamp: number;
      createdAt?: number;
    };
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
  payload: Partial<Pick<ConversationInfo, "enabledTools" | "thinkingLevel" | "directModel">>,
) {
  return apiClient<ConversationDetailResponse>(`/conversations/${conversationId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getMessages(conversationId: string, since?: number) {
  const query = since !== undefined ? `?since=${since}` : "";
  return apiClient<MessageListResponse>(`/conversations/${conversationId}/messages${query}`);
}

export function getEvents(conversationId: string, eventType?: string) {
  const query = eventType ? `?type=${encodeURIComponent(eventType)}` : "";
  return apiClient<EventListResponse>(`/conversations/${conversationId}/events${query}`);
}

export function deleteConversation(conversationId: string) {
  return apiClient<DeleteConversationResponse>(`/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export function clearConversationContext(conversationId: string) {
  return apiClient<ClearConversationContextResponse>(`/conversations/${conversationId}/context/clear`, {
    method: "POST",
  });
}

export function forkConversation(
  conversationId: string,
  payload: { swarmId?: string; title?: string; messageId?: string } = {},
) {
  return apiClient<ConversationDetailResponse>(`/conversations/${conversationId}/fork`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
