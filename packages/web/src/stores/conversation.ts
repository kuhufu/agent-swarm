import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, AgentState, ConversationInfo, ToolCallInfo } from "../types/index.js";
import { useSwarmStore } from "./swarm.js";
import * as conversationsApi from "../api/conversations.js";

export const useConversationStore = defineStore("conversation", () => {
  const swarmStore = useSwarmStore();
  const currentConversationId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const streamingMessages = ref<Map<string, ChatMessage>>(new Map());
  const agentStates = ref<Map<string, AgentState>>(new Map());
  const isActive = ref(false);
  const loading = ref(false);
  const loadingMessages = ref(false);
  const conversations = ref<ConversationInfo[]>([]);
  const jsExecutionToolEnabled = ref(false);

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function streamKeyFromMessage(msg: ChatMessage): string {
    return msg.agentId ?? msg.id;
  }

  function startStreamingMessage(msg: ChatMessage) {
    const key = streamKeyFromMessage(msg);
    const existing = streamingMessages.value.get(key);
    if (existing && existing.content.trim().length > 0) {
      messages.value.push({ ...existing });
    }
    streamingMessages.value.set(key, { ...msg, content: "" });
    streamingMessages.value = new Map(streamingMessages.value);
  }

  function appendStreamDelta(agentId: string, delta: string) {
    const current = streamingMessages.value.get(agentId);
    if (!current) {
      return;
    }
    streamingMessages.value.set(agentId, {
      ...current,
      content: current.content + delta,
    });
    streamingMessages.value = new Map(streamingMessages.value);
  }

  function finalizeStream(agentId?: string) {
    if (agentId) {
      const stream = streamingMessages.value.get(agentId);
      if (stream && stream.content.trim().length > 0) {
        messages.value.push({ ...stream });
      }
      streamingMessages.value.delete(agentId);
      streamingMessages.value = new Map(streamingMessages.value);
      return;
    }

    for (const [key, stream] of streamingMessages.value.entries()) {
      if (stream.content.trim().length > 0) {
        messages.value.push({ ...stream });
      }
      streamingMessages.value.delete(key);
    }
    streamingMessages.value = new Map(streamingMessages.value);
  }

  function clearMessages() {
    messages.value = [];
    streamingMessages.value = new Map();
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
      streamingMessages.value = new Map();
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

  function setJsExecutionToolEnabled(enabled: boolean) {
    jsExecutionToolEnabled.value = enabled;
  }

  return {
    currentConversationId,
    messages,
    streamingMessages,
    agentStates,
    isActive,
    loading,
    loadingMessages,
    conversations,
    jsExecutionToolEnabled,
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
    setJsExecutionToolEnabled,
  };
});
