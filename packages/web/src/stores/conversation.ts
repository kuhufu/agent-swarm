import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ChatMessage, AgentState, ConversationInfo, ToolCallInfo } from "../types/index.js";
import { useSwarmStore } from "./swarm.js";
import * as conversationsApi from "../api/conversations.js";
import {
  normalizeHistoryMessage,
  normalizeHistoryMessages,
} from "../utils/normalize-message.js";
import {
  getCachedMessages,
  setCachedMessages,
  deleteCachedMessages,
} from "../utils/message-cache.js";

interface ConversationRuntimeState {
  messages: ChatMessage[];
  streamingMessages: Map<string, ChatMessage>;
  agentStates: Map<string, AgentState>;
  isActive: boolean;
}

const CONVERSATIONS_CACHE_KEY = "cached-conversations";

function restoreConversationsCache(): ConversationInfo[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ConversationInfo[]) : [];
  } catch {
    localStorage.removeItem(CONVERSATIONS_CACHE_KEY);
    return [];
  }
}

function saveConversationsCache(list: ConversationInfo[]) {
  localStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(list));
}

export const useConversationStore = defineStore("conversation", () => {
  const swarmStore = useSwarmStore();
  const DRAFT_RUNTIME_ID = "__draft__";

  function createEmptyRuntimeState(): ConversationRuntimeState {
    return {
      messages: [],
      streamingMessages: new Map(),
      agentStates: new Map(),
      isActive: false,
    };
  }

  const currentConversationId = ref<string | null>(null);
  const loading = ref(false);
  const loadingMessages = ref(false);
  const conversations = ref<ConversationInfo[]>(restoreConversationsCache());
  const enabledTools = ref<string[]>([]);
  const thinkingLevel = ref<string>("off");
  const thinkModeEnabled = computed(() => thinkingLevel.value !== "off");
  const currentDirectModel = ref<ConversationInfo["directModel"] | null>(null);
  const inputFocusRequestKey = ref(0);
  const runtimeStates = ref<Map<string, ConversationRuntimeState>>(
    new Map([[DRAFT_RUNTIME_ID, createEmptyRuntimeState()]]),
  );

  function normalizeConversationId(id: unknown): string | null {
    if (typeof id !== "string") {
      return null;
    }
    const normalized = id.trim();
    return normalized.length > 0 ? normalized : null;
  }

  function resolveRuntimeStateId(conversationId?: string | null): string {
    const normalized = normalizeConversationId(conversationId);
    if (normalized) {
      return normalized;
    }
    return currentConversationId.value ?? DRAFT_RUNTIME_ID;
  }

  function resolveCurrentRuntimeStateId(): string {
    return currentConversationId.value ?? DRAFT_RUNTIME_ID;
  }

  function getOrCreateRuntimeStateById(runtimeId: string): ConversationRuntimeState {
    const existing = runtimeStates.value.get(runtimeId);
    if (existing) {
      return existing;
    }
    const created = createEmptyRuntimeState();
    runtimeStates.value.set(runtimeId, created);
    runtimeStates.value = new Map(runtimeStates.value);
    return created;
  }

  function resetRuntimeStateById(runtimeId: string) {
    runtimeStates.value.set(runtimeId, createEmptyRuntimeState());
    runtimeStates.value = new Map(runtimeStates.value);
  }

  const messages = computed<ChatMessage[]>(() => {
    const runtimeId = resolveCurrentRuntimeStateId();
    const state = runtimeStates.value.get(runtimeId) ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.messages;
  });

  const streamingMessages = computed<Map<string, ChatMessage>>(() => {
    const runtimeId = resolveCurrentRuntimeStateId();
    const state = runtimeStates.value.get(runtimeId) ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.streamingMessages;
  });

  const agentStates = computed<Map<string, AgentState>>(() => {
    const runtimeId = resolveCurrentRuntimeStateId();
    const state = runtimeStates.value.get(runtimeId) ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.agentStates;
  });

  const isActive = computed<boolean>(() => {
    const runtimeId = resolveCurrentRuntimeStateId();
    const state = runtimeStates.value.get(runtimeId) ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.isActive;
  });

  function cloneToolCall(toolCall: ToolCallInfo): ToolCallInfo {
    return {
      ...toolCall,
      arguments: toolCall.arguments,
      result: toolCall.result,
    };
  }

  function cloneMessage(message: ChatMessage): ChatMessage {
    return {
      ...message,
      toolCalls: Array.isArray(message.toolCalls)
        ? message.toolCalls.map((toolCall) => cloneToolCall(toolCall))
        : undefined,
      metadata: message.metadata ? { ...message.metadata } : undefined,
    };
  }

  function cloneAgentState(state: AgentState): AgentState {
    return {
      ...state,
      model: state.model ? { ...state.model } : undefined,
    };
  }

  function cloneRuntimeState(state: ConversationRuntimeState): ConversationRuntimeState {
    return {
      messages: state.messages.map((message) => cloneMessage(message)),
      streamingMessages: new Map(
        Array.from(state.streamingMessages.entries()).map(([key, message]) => [key, cloneMessage(message)]),
      ),
      agentStates: new Map(
        Array.from(state.agentStates.entries()).map(([key, agentState]) => [key, cloneAgentState(agentState)]),
      ),
      isActive: state.isActive,
    };
  }

  function mutateRuntimeState(
    conversationId: string | null | undefined,
    mutate: (state: ConversationRuntimeState) => void,
  ) {
    const runtimeId = resolveRuntimeStateId(conversationId);
    const runtimeState = getOrCreateRuntimeStateById(runtimeId);
    mutate(runtimeState);
    runtimeStates.value = new Map(runtimeStates.value);
  }

  function hasRuntimeActivity(state: ConversationRuntimeState): boolean {
    return (
      state.messages.length > 0
      || state.streamingMessages.size > 0
      || state.agentStates.size > 0
      || state.isActive
    );
  }

  function mergeRuntimeWithDraftState(
    existingState: ConversationRuntimeState,
    draftState: ConversationRuntimeState,
  ): ConversationRuntimeState {
    const mergedMessageIndex = new Map<string, ChatMessage>();
    for (const message of draftState.messages) {
      mergedMessageIndex.set(message.id, cloneMessage(message));
    }
    for (const message of existingState.messages) {
      mergedMessageIndex.set(message.id, cloneMessage(message));
    }
    const mergedMessages = Array.from(mergedMessageIndex.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.id.localeCompare(b.id);
    });

    const mergedStreamingMessages = new Map<string, ChatMessage>();
    for (const [key, message] of draftState.streamingMessages.entries()) {
      mergedStreamingMessages.set(key, cloneMessage(message));
    }
    for (const [key, message] of existingState.streamingMessages.entries()) {
      mergedStreamingMessages.set(key, cloneMessage(message));
    }

    const mergedAgentStates = new Map<string, AgentState>();
    for (const [agentId, state] of draftState.agentStates.entries()) {
      mergedAgentStates.set(agentId, cloneAgentState(state));
    }
    for (const [agentId, state] of existingState.agentStates.entries()) {
      mergedAgentStates.set(agentId, cloneAgentState(state));
    }

    return {
      messages: mergedMessages,
      streamingMessages: mergedStreamingMessages,
      agentStates: mergedAgentStates,
      isActive: existingState.isActive || draftState.isActive,
    };
  }

  function bindDraftToConversation(conversationId: string) {
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedConversationId || normalizedConversationId === DRAFT_RUNTIME_ID) {
      return;
    }

    const draftState = runtimeStates.value.get(DRAFT_RUNTIME_ID);
    if (!draftState || !hasRuntimeActivity(draftState)) {
      return;
    }

    const existingState = runtimeStates.value.get(normalizedConversationId);
    runtimeStates.value.set(
      normalizedConversationId,
      existingState
        ? mergeRuntimeWithDraftState(existingState, draftState)
        : cloneRuntimeState(draftState),
    );
    runtimeStates.value.set(DRAFT_RUNTIME_ID, createEmptyRuntimeState());
    runtimeStates.value = new Map(runtimeStates.value);
  }

  function addMessage(msg: ChatMessage, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      state.messages.push(cloneMessage(msg));
    });
  }

  function normalizeEnabledTools(input: unknown): string[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const normalized = input
      .filter((tool): tool is string => typeof tool === "string")
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);
    return Array.from(new Set(normalized));
  }

  function applyConversationPreferences(
    preferences?: Partial<Pick<ConversationInfo, "enabledTools" | "thinkingLevel" | "directModel">> | null,
  ) {
    enabledTools.value = normalizeEnabledTools(preferences?.enabledTools);
    thinkingLevel.value = preferences?.thinkingLevel ?? "off";
    currentDirectModel.value = normalizeDirectModel(preferences?.directModel);
  }

  function normalizeDirectModel(
    model: ConversationInfo["directModel"] | null | undefined,
  ): ConversationInfo["directModel"] | null {
    if (!model) {
      return null;
    }
    const provider = typeof model.provider === "string" ? model.provider.trim() : "";
    const modelId = typeof model.modelId === "string" ? model.modelId.trim() : "";
    if (!provider || !modelId) {
      return null;
    }
    return { provider, modelId };
  }

  function updateConversationInfo(id: string, patch: Partial<ConversationInfo>) {
    const index = conversations.value.findIndex((conv) => conv.id === id);
    if (index < 0) {
      return;
    }
    conversations.value[index] = { ...conversations.value[index], ...patch };
    conversations.value = [...conversations.value];
  }

  function mergeToolCall(existing: ToolCallInfo, next: ToolCallInfo): ToolCallInfo {
    return {
      id: existing.id,
      name: typeof next.name === "string" && next.name.trim().length > 0 ? next.name : existing.name,
      arguments: next.arguments !== undefined ? next.arguments : existing.arguments,
      result: next.result !== undefined ? next.result : existing.result,
      isError: typeof next.isError === "boolean" ? next.isError : existing.isError,
    };
  }

  function upsertToolCallInMessage(message: ChatMessage, toolCall: ToolCallInfo): ChatMessage {
    const toolCalls = Array.isArray(message.toolCalls) ? [...message.toolCalls] : [];
    const index = toolCalls.findIndex((item) => item.id === toolCall.id);
    if (index >= 0) {
      toolCalls[index] = mergeToolCall(toolCalls[index], toolCall);
    } else {
      toolCalls.push(toolCall);
    }
    return {
      ...message,
      toolCalls,
    };
  }

  function upsertToolCall(agentId: string | undefined, toolCall: ToolCallInfo, conversationId?: string) {
    if (!toolCall.id || !toolCall.name) {
      return;
    }

    mutateRuntimeState(conversationId, (state) => {
      if (agentId) {
        const streaming = state.streamingMessages.get(agentId);
        if (streaming?.role === "assistant") {
          state.streamingMessages.set(agentId, upsertToolCallInMessage(streaming, toolCall));
          return;
        }
      }

      for (let i = state.messages.length - 1; i >= 0; i--) {
        const message = state.messages[i];
        if (message.role !== "assistant") {
          continue;
        }
        if (agentId && message.agentId !== agentId) {
          continue;
        }
        state.messages[i] = upsertToolCallInMessage(message, toolCall);
        return;
      }

      state.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        agentId,
        agentName: resolveAgentName(agentId, conversationId),
        toolCalls: [toolCall],
        timestamp: Date.now(),
      });
    });
  }

  function streamKeyFromMessage(msg: ChatMessage): string {
    return msg.agentId ?? msg.id;
  }

  function startStreamingMessage(msg: ChatMessage, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const key = streamKeyFromMessage(msg);
      const existing = state.streamingMessages.get(key);
      if (existing && existing.content.trim().length > 0) {
        state.messages.push(cloneMessage(existing));
      }
      state.streamingMessages.set(key, { ...msg, content: "" });
    });
  }

  function appendStreamDelta(agentId: string, delta: string, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const current = state.streamingMessages.get(agentId);
      if (!current) {
        return;
      }
      state.streamingMessages.set(agentId, {
        ...current,
        content: current.content + delta,
      });
    });
  }

  function appendStreamThinkingDelta(agentId: string, delta: string, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const current = state.streamingMessages.get(agentId);
      if (!current) {
        return;
      }
      state.streamingMessages.set(agentId, {
        ...current,
        thinking: (current.thinking ?? "") + delta,
      });
    });
  }

  function shouldPersistStreamMessage(stream: ChatMessage): boolean {
    return (
      stream.content.trim().length > 0
      || (typeof stream.thinking === "string" && stream.thinking.trim().length > 0)
      || (Array.isArray(stream.toolCalls) && stream.toolCalls.length > 0)
    );
  }

  function finalizeStream(agentId?: string, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      if (agentId) {
        const stream = state.streamingMessages.get(agentId);
        if (stream && shouldPersistStreamMessage(stream)) {
          state.messages.push(cloneMessage(stream));
        }
        state.streamingMessages.delete(agentId);
        return;
      }

      for (const [key, stream] of state.streamingMessages.entries()) {
        if (shouldPersistStreamMessage(stream)) {
          state.messages.push(cloneMessage(stream));
        }
        state.streamingMessages.delete(key);
      }
    });
  }

  function clearMessages() {
    mutateRuntimeState(undefined, (state) => {
      state.messages = [];
      state.streamingMessages = new Map();
    });
  }

  function requestInputFocus() {
    inputFocusRequestKey.value += 1;
  }

  function setCurrentConversation(id: string | null) {
    const normalizedId = normalizeConversationId(id);

    if (!normalizedId) {
      currentConversationId.value = null;
      resetRuntimeStateById(DRAFT_RUNTIME_ID);
      applyConversationPreferences(null);
      requestInputFocus();
      return;
    }

    getOrCreateRuntimeStateById(normalizedId);

    if (currentConversationId.value === normalizedId) {
      const conversation = conversations.value.find((item) => item.id === normalizedId);
      if (conversation) {
        applyConversationPreferences(conversation);
      }
      requestInputFocus();
      return;
    }

    currentConversationId.value = normalizedId;
    const conversation = conversations.value.find((item) => item.id === normalizedId);
    if (conversation) {
      applyConversationPreferences(conversation);
    } else {
      applyConversationPreferences(null);
    }
    requestInputFocus();
  }

  function resolveAgentName(agentId?: string, conversationId?: string): string | undefined {
    if (!agentId) {
      return undefined;
    }

    const runtimeId = resolveRuntimeStateId(conversationId);
    const fromState = runtimeStates.value.get(runtimeId)?.agentStates.get(agentId)?.name;
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

  function buildDirectAgentStates(conversation: ConversationInfo, conversationId: string): Map<string, AgentState> {
    const directModel = normalizeDirectModel(conversation.directModel);
    if (!directModel) {
      return new Map();
    }
    const label = `${directModel.provider}/${directModel.modelId}`;
    const existing = runtimeStates.value.get(resolveRuntimeStateId(conversationId))?.agentStates.get("direct-agent");
    return new Map([
      ["direct-agent", {
        id: "direct-agent",
        name: label,
        status: existing?.status ?? "idle",
        model: directModel,
        description: `Direct chat with ${label}`,
        systemPrompt: existing?.systemPrompt ?? "You are a helpful assistant.",
      }],
    ]);
  }

  function populateAgentStatesFromConversation(conversation: ConversationInfo, conversationId: string) {
    if (conversation.swarmId.startsWith("__direct_")) {
      mutateRuntimeState(conversationId, (state) => {
        state.agentStates = buildDirectAgentStates(conversation, conversationId);
      });
      return;
    }

    const matchedSwarm = swarmStore.swarms.find((s) => s.id === conversation.swarmId)
      ?? (swarmStore.currentSwarm?.id === conversation.swarmId ? swarmStore.currentSwarm : null);

    if (!matchedSwarm) {
      mutateRuntimeState(conversationId, (state) => {
        state.agentStates = new Map();
      });
      return;
    }

    const runtimeId = resolveRuntimeStateId(conversationId);
    const existingAgentStates = runtimeStates.value.get(runtimeId)?.agentStates;

    const next = new Map<string, AgentState>();
    const allAgents = [...(matchedSwarm.agents ?? [])];
    if (matchedSwarm.orchestrator) {
      allAgents.push(matchedSwarm.orchestrator);
    }

    for (const agent of allAgents) {
      const existing = existingAgentStates?.get(agent.id);
      next.set(agent.id, {
        id: agent.id,
        name: agent.name,
        status: existing?.status ?? "idle",
        model: agent.model,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
      });
    }

    mutateRuntimeState(conversationId, (state) => {
      state.agentStates = next;
    });
  }

  async function openConversation(id: string) {
    const normalizedConversationId = normalizeConversationId(id);
    if (!normalizedConversationId) {
      return;
    }

    // If runtime already has messages, just switch to it without any API call
    const existingRuntime = runtimeStates.value.get(resolveRuntimeStateId(normalizedConversationId));
    if (existingRuntime && existingRuntime.messages.length > 0 && !existingRuntime.isActive && existingRuntime.streamingMessages.size === 0) {
      setCurrentConversation(normalizedConversationId);
      return;
    }

    loadingMessages.value = true;
    try {
      // Fetch conversation info (always needed)
      const conversationRes = await conversationsApi.getConversation(normalizedConversationId);

      setCurrentConversation(normalizedConversationId);
      applyConversationPreferences(conversationRes.data);
      updateConversationInfo(normalizedConversationId, conversationRes.data);

      if (conversationRes.data.swarmId.startsWith("__direct_")) {
        swarmStore.clearSwarmSelection();
      } else {
        let matchedSwarm = swarmStore.swarms.find((item) => item.id === conversationRes.data.swarmId);
        if (!matchedSwarm) {
          try {
            await swarmStore.fetchSwarms();
          } catch {
            // ignore swarm refresh failure and fallback to runtime state
          }
          matchedSwarm = swarmStore.swarms.find((item) => item.id === conversationRes.data.swarmId);
        }
        if (matchedSwarm) {
          if (swarmStore.currentSwarm?.id !== matchedSwarm.id) {
            swarmStore.selectSwarm(matchedSwarm);
          }
        } else {
          swarmStore.clearSwarmSelection();
        }
      }
      populateAgentStatesFromConversation(conversationRes.data, normalizedConversationId);

      // Try IDB cache for instant render
      const cached = await getCachedMessages(normalizedConversationId);
      if (cached && cached.messages.length > 0) {
        mutateRuntimeState(normalizedConversationId, (state) => {
          state.messages = normalizeHistoryMessages(cached.messages, resolveAgentName);
        });
      }

      // Fetch messages from API, with `since` if cached
      const since = cached ? cached.maxCreatedAt : undefined;
      const messagesRes = await conversationsApi.getMessages(normalizedConversationId, since);
      const apiMessages = Array.isArray(messagesRes.data) ? messagesRes.data : [];

      mutateRuntimeState(normalizedConversationId, (state) => {
        if (since && cached && state.messages.length > 0) {
          const existingIds = new Set(state.messages.map((m) => m.id));
          const newMessages = normalizeHistoryMessages(
            apiMessages.filter((m) => !existingIds.has(m.id)),
            resolveAgentName,
          );
          state.messages = [...state.messages, ...newMessages];
        } else {
          state.messages = normalizeHistoryMessages(apiMessages, resolveAgentName);
        }
        state.streamingMessages = new Map();
        state.isActive = false;
      });

      // Update IDB cache
      const finalState = runtimeStates.value.get(normalizedConversationId);
      if (finalState) {
        const maxCreatedAt = finalState.messages.reduce(
          (max, m) => Math.max(max, m.createdAt ?? 0), 0,
        );
        void setCachedMessages(normalizedConversationId, finalState.messages, maxCreatedAt);
      }
    } finally {
      loadingMessages.value = false;
    }
  }

  function setAgentStatus(agentId: string, status: AgentState["status"], conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const current = state.agentStates.get(agentId);
      state.agentStates.set(agentId, {
        id: agentId,
        name: current?.name ?? agentId,
        status,
        model: current?.model,
        description: current?.description,
        systemPrompt: current?.systemPrompt,
      });
    });
  }

  function setAgentName(agentId: string, name: string, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const current = state.agentStates.get(agentId);
      state.agentStates.set(agentId, {
        id: agentId,
        name,
        status: current?.status ?? "idle",
        model: current?.model,
        description: current?.description,
        systemPrompt: current?.systemPrompt,
      });
    });
  }

  function setAgentModel(agentId: string, model: { provider: string; modelId: string }, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      const current = state.agentStates.get(agentId);
      state.agentStates.set(agentId, {
        id: agentId,
        name: current?.name ?? agentId,
        status: current?.status ?? "idle",
        model,
        description: current?.description,
        systemPrompt: current?.systemPrompt,
      });
    });
  }

  function setActive(active: boolean, conversationId?: string) {
    mutateRuntimeState(conversationId, (state) => {
      state.isActive = active;
    });
  }

  async function fetchConversations(swarmId: string) {
    loading.value = true;
    try {
      const res = await conversationsApi.listConversations(swarmId);
      conversations.value = res.data;
      saveConversationsCache(res.data);
      if (currentConversationId.value) {
        const current = conversations.value.find((conv) => conv.id === currentConversationId.value);
        if (current) {
          applyConversationPreferences(current);
        }
      }
    } finally {
      loading.value = false;
    }
  }

  async function fetchAllConversations() {
    loading.value = true;
    try {
      const res = await conversationsApi.listConversations();
      conversations.value = res.data;
      saveConversationsCache(res.data);
      if (currentConversationId.value) {
        const current = conversations.value.find((conv) => conv.id === currentConversationId.value);
        if (current) {
          applyConversationPreferences(current);
        }
      }
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

  function cacheCurrentConversation() {
    const conversationId = currentConversationId.value;
    if (!conversationId) return;
    const state = runtimeStates.value.get(conversationId);
    if (!state) return;
    const lastMsg = state.messages[state.messages.length - 1];
    const maxCreatedAt = state.messages.reduce(
      (max, m) => Math.max(max, m.createdAt ?? 0), 0,
    );
    void setCachedMessages(conversationId, state.messages, maxCreatedAt);
  }

  async function deleteConversation(id: string) {
    await conversationsApi.deleteConversation(id);
    conversations.value = conversations.value.filter((conv) => conv.id !== id);
    saveConversationsCache(conversations.value);
    runtimeStates.value.delete(id);
    runtimeStates.value = new Map(runtimeStates.value);
    void deleteCachedMessages(id);
    if (currentConversationId.value === id) {
      setCurrentConversation(null);
    }
  }

  async function clearCurrentConversationContext() {
    const conversationId = currentConversationId.value;
    if (!conversationId) {
      throw new Error("当前没有可清空上下文的会话");
    }

    const res = await conversationsApi.clearConversationContext(conversationId);
    const runtimeState = getOrCreateRuntimeStateById(conversationId);

    if (runtimeState.streamingMessages.size > 0) {
      finalizeStream(undefined, conversationId);
    }

    mutateRuntimeState(conversationId, (state) => {
      if (state.agentStates.size > 0) {
        const next = new Map<string, AgentState>();
        for (const [agentId, agentState] of state.agentStates.entries()) {
          next.set(agentId, {
            ...agentState,
            status: "idle",
          });
        }
        state.agentStates = next;
      }
      state.isActive = false;
    });

    if (res.data.markerMessage) {
      const marker = normalizeHistoryMessage(res.data.markerMessage, resolveAgentName);
      addMessage(marker, conversationId);
    }

    // Context cleared → cached messages are stale
    void deleteCachedMessages(conversationId);

    return res.data;
  }

  async function persistCurrentConversationPreferences(
    patch: Partial<Pick<ConversationInfo, "enabledTools" | "thinkingLevel" | "directModel">>,
  ) {
    const conversationId = currentConversationId.value;
    if (!conversationId) {
      return;
    }

    const res = await conversationsApi.updateConversationPreferences(conversationId, patch);
    updateConversationInfo(conversationId, res.data);
    applyConversationPreferences(res.data);
  }

  function isToolEnabled(toolName: string): boolean {
    return enabledTools.value.includes(toolName);
  }

  function setEnabledTools(nextTools: string[], persist = true) {
    enabledTools.value = normalizeEnabledTools(nextTools);
    if (persist) {
      void persistCurrentConversationPreferences({ enabledTools: enabledTools.value }).catch(() => {
        // ignore persistence failures; current UI state is still usable for this turn
      });
    }
  }

  function setClientToolEnabled(toolName: string, enabled: boolean, persist = true) {
    const next = new Set(enabledTools.value);
    if (enabled) {
      next.add(toolName);
    } else {
      next.delete(toolName);
    }
    setEnabledTools(Array.from(next), persist);
  }

  function setThinkingLevel(level: string, persist = true) {
    thinkingLevel.value = level;
    if (persist) {
      void persistCurrentConversationPreferences({ thinkingLevel: level }).catch(() => {
        // ignore persistence failures; current UI state is still usable for this turn
      });
    }
  }

  function setDirectModel(
    model: ConversationInfo["directModel"] | null,
    persist = true,
  ) {
    const normalized = normalizeDirectModel(model);
    currentDirectModel.value = normalized;

    const conversationId = currentConversationId.value;
    const currentConversation = conversationId
      ? conversations.value.find((item) => item.id === conversationId)
      : undefined;
    const isDirectConversation = Boolean(
      currentConversation && currentConversation.swarmId.startsWith("__direct_"),
    );

    if (conversationId && isDirectConversation) {
      updateConversationInfo(conversationId, { directModel: normalized ?? undefined });
    }

    if (persist && conversationId && normalized && isDirectConversation) {
      void persistCurrentConversationPreferences({ directModel: normalized }).catch(() => {
        // ignore persistence failures; current UI state is still usable for this turn
      });
    }
  }

  function applyConversationSettingsFromServer(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    const raw = payload as Record<string, unknown>;
    const conversationId = typeof raw.conversationId === "string" ? raw.conversationId : currentConversationId.value;
    const isCurrentConversation = conversationId === currentConversationId.value;
    const patch: Partial<ConversationInfo> = {};

    if (Array.isArray(raw.enabledTools)) {
      patch.enabledTools = normalizeEnabledTools(raw.enabledTools);
      if (isCurrentConversation) {
        enabledTools.value = patch.enabledTools;
      }
    }
    if (typeof raw.thinkingLevel === "string") {
      patch.thinkingLevel = raw.thinkingLevel;
      if (isCurrentConversation) {
        thinkingLevel.value = raw.thinkingLevel;
      }
    }
    if (raw.directModel && typeof raw.directModel === "object" && !Array.isArray(raw.directModel)) {
      const normalized = normalizeDirectModel(raw.directModel as ConversationInfo["directModel"]);
      if (normalized) {
        patch.directModel = normalized;
        if (isCurrentConversation) {
          currentDirectModel.value = normalized;
        }
      }
    }

    if (
      conversationId
      && (
        patch.enabledTools !== undefined
        || patch.thinkingLevel !== undefined
        || patch.directModel !== undefined
      )
    ) {
      updateConversationInfo(conversationId, patch);
    }
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
    enabledTools,
    thinkModeEnabled,
    thinkingLevel,
    currentDirectModel,
    inputFocusRequestKey,
    addMessage,
    upsertToolCall,
    startStreamingMessage,
    appendStreamDelta,
    appendStreamThinkingDelta,
    finalizeStream,
    clearMessages,
    bindDraftToConversation,
    setCurrentConversation,
    openConversation,
    setAgentStatus,
    setAgentName,
    setAgentModel,
    setActive,
    fetchConversations,
    fetchAllConversations,
    updateConversationTitle,
    deleteConversation,
    cacheCurrentConversation,
    clearCurrentConversationContext,
    isToolEnabled,
    setEnabledTools,
    setClientToolEnabled,
    setThinkingLevel,
    setDirectModel,
    requestInputFocus,
    applyConversationSettingsFromServer,
  };
});
