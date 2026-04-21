import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, AgentState, ConversationInfo } from "../types/index.js";
import * as conversationsApi from "../api/conversations.js";

export const useConversationStore = defineStore("conversation", () => {
  const currentConversationId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const streamingMessage = ref<ChatMessage | null>(null);
  const agentStates = ref<Map<string, AgentState>>(new Map());
  const isActive = ref(false);
  const loading = ref(false);
  const conversations = ref<ConversationInfo[]>([]);

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function startStreamingMessage(msg: ChatMessage) {
    streamingMessage.value = { ...msg, content: "" };
  }

  function appendStreamDelta(delta: string) {
    if (streamingMessage.value) {
      streamingMessage.value = {
        ...streamingMessage.value,
        content: streamingMessage.value.content + delta,
      };
    }
  }

  function finalizeStream() {
    if (streamingMessage.value) {
      messages.value.push({ ...streamingMessage.value });
      streamingMessage.value = null;
    }
  }

  function clearMessages() {
    messages.value = [];
    streamingMessage.value = null;
  }

  function setCurrentConversation(id: string | null) {
    currentConversationId.value = id;
    if (id === null) {
      clearMessages();
    }
  }

  function setAgentStatus(agentId: string, status: AgentState["status"]) {
    const current = agentStates.value.get(agentId);
    agentStates.value.set(agentId, {
      id: agentId,
      name: current?.name ?? agentId,
      status,
    });
    // Trigger reactivity
    agentStates.value = new Map(agentStates.value);
  }

  function setAgentName(agentId: string, name: string) {
    const current = agentStates.value.get(agentId);
    agentStates.value.set(agentId, {
      id: agentId,
      name,
      status: current?.status ?? "idle",
    });
    agentStates.value = new Map(agentStates.value);
  }

  function setActive(active: boolean) {
    isActive.value = active;
  }

  async function fetchConversations(swarmId: string) {
    loading.value = true;
    try {
      const res = await conversationsApi.listConversations(swarmId);
      conversations.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  function updateConversationTitle(id: string, title: string) {
    const conv = conversations.value.find((c) => c.id === id);
    if (conv) {
      conv.title = title;
    }
  }

  return {
    currentConversationId,
    messages,
    streamingMessage,
    agentStates,
    isActive,
    loading,
    conversations,
    addMessage,
    startStreamingMessage,
    appendStreamDelta,
    finalizeStream,
    clearMessages,
    setCurrentConversation,
    setAgentStatus,
    setAgentName,
    setActive,
    fetchConversations,
    updateConversationTitle,
  };
});
