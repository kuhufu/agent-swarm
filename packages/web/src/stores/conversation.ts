import { defineStore } from "pinia";
import { ref } from "vue";
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
import { CACHE_KEYS } from "../utils/cache-keys.js";

interface ConversationRuntimeState {
  messages: ChatMessage[];
  streamingMessages: Map<string, ChatMessage>;
  agentStates: Map<string, AgentState>;
  activeAssistantMessageIds: Map<string, string>;
  toolCallMessageIds: Map<string, string>;
  isActive: boolean;
}

type ConversationPreferences = Partial<Pick<ConversationInfo, "enabledTools" | "thinkingLevel" | "directModel">>;

const CONVERSATIONS_CACHE_KEY = CACHE_KEYS.CONVERSATIONS;

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

function hasServerCreatedAt(message: ChatMessage): boolean {
  return typeof message.createdAt === "number" && message.createdAt > 0;
}

function stableToolCallsKey(message: ChatMessage): string {
  if (!Array.isArray(message.toolCalls) || message.toolCalls.length === 0) {
    return "";
  }
  try {
    return JSON.stringify(message.toolCalls);
  } catch {
    return "";
  }
}

function logicalMessageKey(message: ChatMessage): string {
  return [
    message.role,
    message.agentId ?? "",
    message.content ?? "",
    message.thinking ?? "",
    stableToolCallsKey(message),
  ].join("\u001f");
}

function isLikelyConfirmedLocalMessage(local: ChatMessage, remote: ChatMessage): boolean {
  if (hasServerCreatedAt(local)) {
    return false;
  }
  if (logicalMessageKey(local) !== logicalMessageKey(remote)) {
    return false;
  }
  const localTimestamp = typeof local.timestamp === "number" ? local.timestamp : 0;
  const remoteTimestamp = typeof remote.timestamp === "number" ? remote.timestamp : 0;
  if (localTimestamp <= 0 || remoteTimestamp <= 0) {
    return true;
  }
  return Math.abs(localTimestamp - remoteTimestamp) <= 10 * 60 * 1000;
}

function mergeCachedAndIncrementalMessages(
  cachedMessages: ChatMessage[],
  incrementalMessages: ChatMessage[],
): ChatMessage[] {
  if (cachedMessages.length === 0) {
    return incrementalMessages;
  }
  if (incrementalMessages.length === 0) {
    return cachedMessages;
  }

  const incrementalById = new Map(incrementalMessages.map((message) => [message.id, message]));
  const merged: ChatMessage[] = [];

  for (const cachedMessage of cachedMessages) {
    const sameIdIncremental = incrementalById.get(cachedMessage.id);
    if (sameIdIncremental) {
      merged.push(sameIdIncremental);
      continue;
    }
    if (incrementalMessages.some((message) => isLikelyConfirmedLocalMessage(cachedMessage, message))) {
      continue;
    }
    merged.push(cachedMessage);
  }

  const mergedIds = new Set(merged.map((message) => message.id));
  for (const incrementalMessage of incrementalMessages) {
    if (!mergedIds.has(incrementalMessage.id)) {
      merged.push(incrementalMessage);
    }
  }

  return merged;
}

export const useConversationStore = defineStore("conversation", () => {
  const swarmStore = useSwarmStore();
  const DRAFT_RUNTIME_ID = "__draft__";

  function createEmptyRuntimeState(): ConversationRuntimeState {
    return {
      messages: [],
      streamingMessages: new Map(),
      agentStates: new Map(),
      activeAssistantMessageIds: new Map(),
      toolCallMessageIds: new Map(),
      isActive: false,
    };
  }

  const loading = ref(false);
  const loadingMessages = ref(false);
  const conversations = ref<ConversationInfo[]>(restoreConversationsCache());
  const inputFocusRequestKey = ref(0);
  const conversationPreferences = ref<Map<string, ConversationPreferences>>(new Map());
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
    return DRAFT_RUNTIME_ID;
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

  function getMessages(conversationId?: string | null): ChatMessage[] {
    const state = runtimeStates.value.get(resolveRuntimeStateId(conversationId))
      ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.messages;
  }

  function getStreamingMessages(conversationId?: string | null): Map<string, ChatMessage> {
    const state = runtimeStates.value.get(resolveRuntimeStateId(conversationId))
      ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.streamingMessages;
  }

  function getAgentStates(conversationId?: string | null): Map<string, AgentState> {
    const state = runtimeStates.value.get(resolveRuntimeStateId(conversationId))
      ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.agentStates;
  }

  function getIsActive(conversationId?: string | null): boolean {
    const state = runtimeStates.value.get(resolveRuntimeStateId(conversationId))
      ?? runtimeStates.value.get(DRAFT_RUNTIME_ID)!;
    return state.isActive;
  }

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
      activeAssistantMessageIds: new Map(state.activeAssistantMessageIds),
      toolCallMessageIds: new Map(state.toolCallMessageIds),
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

    const mergedActiveAssistantMessageIds = new Map(draftState.activeAssistantMessageIds);
    for (const [agentId, messageId] of existingState.activeAssistantMessageIds.entries()) {
      mergedActiveAssistantMessageIds.set(agentId, messageId);
    }

    const mergedToolCallMessageIds = new Map(draftState.toolCallMessageIds);
    for (const [toolCallId, messageId] of existingState.toolCallMessageIds.entries()) {
      mergedToolCallMessageIds.set(toolCallId, messageId);
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
      activeAssistantMessageIds: mergedActiveAssistantMessageIds,
      toolCallMessageIds: mergedToolCallMessageIds,
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

  function getDirectModel(conversationId?: string | null): ConversationInfo["directModel"] | null {
    if (!conversationId) {
      return null;
    }
    const conversation = conversations.value.find((item) => item.id === conversationId);
    const fallback = conversationPreferences.value.get(conversationId)?.directModel;
    return normalizeDirectModel(conversation?.directModel ?? fallback);
  }

  function getEnabledTools(conversationId?: string | null): string[] {
    if (!conversationId) {
      return [];
    }
    const conversation = conversations.value.find((item) => item.id === conversationId);
    const fallback = conversationPreferences.value.get(conversationId)?.enabledTools;
    return normalizeEnabledTools(conversation?.enabledTools ?? fallback);
  }

  function getThinkingLevel(conversationId?: string | null): string {
    if (!conversationId) {
      return "off";
    }
    const conversation = conversations.value.find((item) => item.id === conversationId);
    return conversation?.thinkingLevel ?? conversationPreferences.value.get(conversationId)?.thinkingLevel ?? "off";
  }

  function setConversationPreferenceFallback(id: string, patch: ConversationPreferences) {
    conversationPreferences.value.set(id, {
      ...(conversationPreferences.value.get(id) ?? {}),
      ...patch,
    });
    conversationPreferences.value = new Map(conversationPreferences.value);
  }

  function updateConversationInfo(id: string, patch: Partial<ConversationInfo>) {
    const index = conversations.value.findIndex((conv) => conv.id === id);
    if (index < 0) {
      setConversationPreferenceFallback(id, patch);
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

  function findMessageIndexById(messages: ChatMessage[], messageId: string): number {
    return messages.findIndex((message) => message.id === messageId);
  }

  function isToolOnlyAssistantMessage(message: ChatMessage): boolean {
    return message.role === "assistant"
      && message.content.trim().length === 0
      && !(typeof message.thinking === "string" && message.thinking.trim().length > 0)
      && Array.isArray(message.toolCalls)
      && message.toolCalls.length > 0;
  }

  function findConsecutiveToolCallMessageIndex(messages: ChatMessage[], agentId: string | undefined): number {
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) {
      return -1;
    }
    const lastMessage = messages[lastIndex];
    if (!isToolOnlyAssistantMessage(lastMessage)) {
      return -1;
    }
    if (agentId && lastMessage.agentId !== agentId) {
      return -1;
    }
    return lastIndex;
  }

  function upsertToolCall(agentId: string | undefined, toolCall: ToolCallInfo, conversationId?: string) {
    if (!toolCall.id || !toolCall.name) {
      return;
    }

    mutateRuntimeState(conversationId, (state) => {
      const boundMessageId = state.toolCallMessageIds.get(toolCall.id);
      if (boundMessageId) {
        const boundMessageIndex = findMessageIndexById(state.messages, boundMessageId);
        if (boundMessageIndex >= 0) {
          state.messages[boundMessageIndex] = upsertToolCallInMessage(
            state.messages[boundMessageIndex],
            toolCall,
          );
          return;
        }
        for (const [streamKey, stream] of state.streamingMessages.entries()) {
          if (stream.id === boundMessageId) {
            state.streamingMessages.set(streamKey, upsertToolCallInMessage(stream, toolCall));
            return;
          }
        }
      }

      const groupIndex = findConsecutiveToolCallMessageIndex(state.messages, agentId);
      if (groupIndex >= 0) {
        state.messages[groupIndex] = upsertToolCallInMessage(state.messages[groupIndex], toolCall);
        state.toolCallMessageIds.set(toolCall.id, state.messages[groupIndex].id);
        return;
      }

      const messageId = crypto.randomUUID();
      state.messages.push({
        id: messageId,
        role: "assistant",
        content: "",
        agentId,
        agentName: resolveAgentName(agentId, conversationId),
        toolCalls: [toolCall],
        timestamp: Date.now(),
      });
      if (agentId) {
        state.activeAssistantMessageIds.set(agentId, messageId);
      }
      state.toolCallMessageIds.set(toolCall.id, messageId);
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
      const nextMessage = {
        ...msg,
        content: "",
      };
      state.streamingMessages.set(key, nextMessage);
      if (msg.role === "assistant" && msg.agentId) {
        state.activeAssistantMessageIds.set(msg.agentId, nextMessage.id);
      }
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
          if (stream.role === "assistant") {
            state.activeAssistantMessageIds.set(agentId, stream.id);
          }
        }
        state.streamingMessages.delete(agentId);
        return;
      }

      for (const [key, stream] of state.streamingMessages.entries()) {
        if (shouldPersistStreamMessage(stream)) {
          state.messages.push(cloneMessage(stream));
          if (stream.role === "assistant" && stream.agentId) {
            state.activeAssistantMessageIds.set(stream.agentId, stream.id);
          }
        }
        state.streamingMessages.delete(key);
      }
    });
  }

  function clearMessages() {
    mutateRuntimeState(undefined, (state) => {
      state.messages = [];
      state.streamingMessages = new Map();
      state.activeAssistantMessageIds = new Map();
      state.toolCallMessageIds = new Map();
    });
  }

  function requestInputFocus() {
    inputFocusRequestKey.value += 1;
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

    const conversation = conversationId
      ? conversations.value.find((item) => item.id === conversationId)
      : null;
    const swarm = swarmStore.getSwarmById(conversation?.swarmId);
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

    const matchedSwarm = swarmStore.getSwarmById(conversation.swarmId);

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
      requestInputFocus();
      return;
    }

    getOrCreateRuntimeStateById(normalizedConversationId);
    requestInputFocus();

    loadingMessages.value = true;
    try {
      // Fetch conversation info (always needed)
      const conversationRes = await conversationsApi.getConversation(normalizedConversationId);

      updateConversationInfo(normalizedConversationId, conversationRes.data);

      if (conversationRes.data.swarmId.startsWith("__direct_")) {
        // Direct conversations do not require a Swarm selection.
      } else {
        if (!swarmStore.getSwarmById(conversationRes.data.swarmId)) {
          try {
            await swarmStore.fetchSwarms();
          } catch {
            // ignore swarm refresh failure and fallback to runtime state
          }
        }
      }
      populateAgentStatesFromConversation(conversationRes.data, normalizedConversationId);

      // Try IDB cache for instant render
      const cached = await getCachedMessages(normalizedConversationId);
      if (cached && cached.messages.length > 0) {
        mutateRuntimeState(normalizedConversationId, (state) => {
          state.messages = normalizeHistoryMessages(cached.messages, resolveAgentName);
          state.activeAssistantMessageIds = new Map();
          state.toolCallMessageIds = new Map();
        });
      }

      // Fetch messages from API, with `since` if cached
      const since = cached ? cached.maxCreatedAt : undefined;
      const messagesRes = await conversationsApi.getMessages(normalizedConversationId, since);
      const apiMessages = Array.isArray(messagesRes.data) ? messagesRes.data : [];
      const mergedMessages = mergeCachedAndIncrementalMessages(cached?.messages ?? [], apiMessages);

      mutateRuntimeState(normalizedConversationId, (state) => {
        state.messages = normalizeHistoryMessages(mergedMessages, resolveAgentName);
        state.streamingMessages = new Map();
        state.activeAssistantMessageIds = new Map();
        state.toolCallMessageIds = new Map();
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
    saveConversationsCache(conversations.value);
    runtimeStates.value.delete(id);
    runtimeStates.value = new Map(runtimeStates.value);
    void deleteCachedMessages(id);
  }

  async function clearConversationContext(conversationId: string | null | undefined) {
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

  async function persistConversationPreferences(
    conversationId: string,
    patch: Partial<Pick<ConversationInfo, "enabledTools" | "thinkingLevel" | "directModel">>,
  ) {
    updateConversationInfo(conversationId, patch);
    const res = await conversationsApi.updateConversationPreferences(conversationId, patch);
    updateConversationInfo(conversationId, res.data);
    return res.data;
  }

  function setDirectModel(
    conversationId: string | null | undefined,
    model: ConversationInfo["directModel"] | null,
    persist = true,
  ) {
    const normalized = normalizeDirectModel(model);
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
      void persistConversationPreferences(conversationId, { directModel: normalized }).catch(() => {
        // ignore persistence failures; current UI state is still usable for this turn
      });
    }
  }

  function applyConversationSettingsFromServer(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    const raw = payload as Record<string, unknown>;
    const conversationId = typeof raw.conversationId === "string" ? raw.conversationId : null;
    const patch: Partial<ConversationInfo> = {};

    if (Array.isArray(raw.enabledTools)) {
      patch.enabledTools = normalizeEnabledTools(raw.enabledTools);
    }
    if (typeof raw.thinkingLevel === "string") {
      patch.thinkingLevel = raw.thinkingLevel;
    }
    if (raw.directModel && typeof raw.directModel === "object" && !Array.isArray(raw.directModel)) {
      const normalized = normalizeDirectModel(raw.directModel as ConversationInfo["directModel"]);
      if (normalized) {
        patch.directModel = normalized;
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

  function reset() {
    loading.value = false;
    loadingMessages.value = false;
    conversations.value = [];
    conversationPreferences.value = new Map();
    runtimeStates.value = new Map([[DRAFT_RUNTIME_ID, createEmptyRuntimeState()]]);
  }

  return {
    getMessages,
    getStreamingMessages,
    getAgentStates,
    getIsActive,
    loading,
    loadingMessages,
    conversations,
    inputFocusRequestKey,
    addMessage,
    upsertToolCall,
    startStreamingMessage,
    appendStreamDelta,
    appendStreamThinkingDelta,
    finalizeStream,
    clearMessages,
    bindDraftToConversation,
    openConversation,
    setAgentStatus,
    setAgentName,
    setAgentModel,
    setActive,
    fetchConversations,
    fetchAllConversations,
    updateConversationTitle,
    deleteConversation,
    clearConversationContext,
    updateConversationPreferences: persistConversationPreferences,
    setDirectModel,
    getDirectModel,
    getEnabledTools,
    getThinkingLevel,
    requestInputFocus,
    applyConversationSettingsFromServer,
    reset,
  };
});
