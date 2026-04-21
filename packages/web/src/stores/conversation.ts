import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, AgentState, ConversationInfo, ToolCallInfo } from "../types/index.js";
import { useSwarmStore } from "./swarm.js";
import * as conversationsApi from "../api/conversations.js";

export const useConversationStore = defineStore("conversation", () => {
  const swarmStore = useSwarmStore();
  const currentConversationId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const streamingMessage = ref<ChatMessage | null>(null);
  const agentStates = ref<Map<string, AgentState>>(new Map());
  const isActive = ref(false);
  const loading = ref(false);
  const loadingMessages = ref(false);
  const conversations = ref<ConversationInfo[]>([]);

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function startStreamingMessage(msg: ChatMessage) {
    // Close previous stream first to avoid losing partial text
    if (streamingMessage.value && streamingMessage.value.content.trim().length > 0) {
      messages.value.push({ ...streamingMessage.value });
    }
    streamingMessage.value = { ...msg, content: "" };
  }

  function appendStreamDelta(agentId: string, delta: string) {
    if (streamingMessage.value && streamingMessage.value.agentId === agentId) {
      streamingMessage.value = {
        ...streamingMessage.value,
        content: streamingMessage.value.content + delta,
      };
    }
  }

  function finalizeStream(agentId?: string) {
    if (streamingMessage.value && (!agentId || streamingMessage.value.agentId === agentId)) {
      if (streamingMessage.value.content.trim().length > 0) {
        messages.value.push({ ...streamingMessage.value });
      }
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

  function normalizeRole(role: unknown): ChatMessage["role"] {
    switch (role) {
      case "user":
      case "assistant":
      case "system":
      case "notification":
      case "tool_result":
        return role;
      case "toolResult":
        return "tool_result";
      default:
        return "notification";
    }
  }

  function normalizeToolCalls(toolCalls: unknown): ToolCallInfo[] | undefined {
    if (Array.isArray(toolCalls)) {
      return toolCalls as ToolCallInfo[];
    }
    if (typeof toolCalls === "string") {
      try {
        const parsed = JSON.parse(toolCalls) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as ToolCallInfo[];
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  function normalizeHistoryMessage(raw: unknown): ChatMessage {
    if (!raw || typeof raw !== "object") {
      return {
        id: crypto.randomUUID(),
        role: "system",
        content: "",
        timestamp: Date.now(),
      };
    }

    const message = raw as Record<string, unknown>;
    const role = normalizeRole(message.role);
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = normalizeToolCalls(message.toolCalls);
    const thinking = typeof message.thinking === "string" ? message.thinking : undefined;
    const agentId = typeof message.agentId === "string" ? message.agentId : undefined;
    const agentName = typeof message.agentName === "string" ? message.agentName : resolveAgentName(agentId);
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
    const id = typeof message.id === "string" ? message.id : crypto.randomUUID();

    return {
      id,
      role,
      content,
      thinking,
      toolCalls,
      agentId,
      agentName,
      timestamp,
    };
  }

  function resolveAgentName(agentId?: string): string | undefined {
    if (!agentId) {
      return undefined;
    }

    const fromState = agentStates.value.get(agentId)?.name;
    if (fromState && fromState !== agentId) {
      return fromState;
    }

    const swarm = swarmStore.currentSwarm;
    if (!swarm) {
      return undefined;
    }

    const agent = swarm.agents.find((a) => a.id === agentId)
      ?? (swarm.orchestrator?.id === agentId ? swarm.orchestrator : undefined);
    return agent?.name;
  }

  async function openConversation(id: string) {
    loadingMessages.value = true;
    try {
      const res = await conversationsApi.getMessages(id);
      currentConversationId.value = id;
      messages.value = (Array.isArray(res.data) ? res.data : []).map((msg) => normalizeHistoryMessage(msg));
      streamingMessage.value = null;
      isActive.value = false;
    } finally {
      loadingMessages.value = false;
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

  async function deleteConversation(id: string) {
    await conversationsApi.deleteConversation(id);
    conversations.value = conversations.value.filter((conv) => conv.id !== id);
    if (currentConversationId.value === id) {
      setCurrentConversation(null);
      isActive.value = false;
    }
  }

  return {
    currentConversationId,
    messages,
    streamingMessage,
    agentStates,
    isActive,
    loading,
    loadingMessages,
    conversations,
    addMessage,
    startStreamingMessage,
    appendStreamDelta,
    finalizeStream,
    clearMessages,
    setCurrentConversation,
    openConversation,
    setAgentStatus,
    setAgentName,
    setActive,
    fetchConversations,
    updateConversationTitle,
    deleteConversation,
  };
});
