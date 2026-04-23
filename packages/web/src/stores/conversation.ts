import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, AgentState, ConversationInfo, ToolCallInfo } from "../types/index.js";
import { useSwarmStore } from "./swarm.js";
import * as conversationsApi from "../api/conversations.js";

interface ConversationRuntimeState {
  messages: ChatMessage[];
  streamingMessages: Map<string, ChatMessage>;
  agentStates: Map<string, AgentState>;
  isActive: boolean;
}

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
  const enabledTools = ref<string[]>([]);
  const thinkModeEnabled = ref(false);
  const currentDirectModel = ref<ConversationInfo["directModel"] | null>(null);
  const runtimeStates = ref<Map<string, ConversationRuntimeState>>(new Map());

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

  function getOrCreateRuntimeState(conversationId: string): ConversationRuntimeState {
    const existing = runtimeStates.value.get(conversationId);
    if (existing) {
      return existing;
    }
    const created: ConversationRuntimeState = {
      messages: [],
      streamingMessages: new Map(),
      agentStates: new Map(),
      isActive: false,
    };
    runtimeStates.value.set(conversationId, created);
    runtimeStates.value = new Map(runtimeStates.value);
    return created;
  }

  function persistCurrentRuntimeState() {
    const conversationId = currentConversationId.value;
    if (!conversationId) {
      return;
    }
    runtimeStates.value.set(conversationId, {
      messages: messages.value.map((message) => cloneMessage(message)),
      streamingMessages: new Map(
        Array.from(streamingMessages.value.entries()).map(([key, message]) => [key, cloneMessage(message)]),
      ),
      agentStates: new Map(
        Array.from(agentStates.value.entries()).map(([key, state]) => [key, cloneAgentState(state)]),
      ),
      isActive: isActive.value,
    });
    runtimeStates.value = new Map(runtimeStates.value);
  }

  function restoreRuntimeState(conversationId: string): boolean {
    const runtimeState = runtimeStates.value.get(conversationId);
    if (!runtimeState) {
      return false;
    }
    const cloned = cloneRuntimeState(runtimeState);
    messages.value = cloned.messages;
    streamingMessages.value = cloned.streamingMessages;
    agentStates.value = cloned.agentStates;
    isActive.value = cloned.isActive;
    return true;
  }

  function mutateRuntimeState(conversationId: string, mutate: (state: ConversationRuntimeState) => void) {
    const runtimeState = getOrCreateRuntimeState(conversationId);
    mutate(runtimeState);
    runtimeStates.value = new Map(runtimeStates.value);
  }

  function addMessage(msg: ChatMessage, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
      mutateRuntimeState(conversationId, (state) => {
        state.messages.push(cloneMessage(msg));
      });
      return;
    }
    messages.value.push(msg);
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
    preferences?: Partial<Pick<ConversationInfo, "enabledTools" | "thinkModeEnabled" | "directModel">> | null,
  ) {
    enabledTools.value = normalizeEnabledTools(preferences?.enabledTools);
    thinkModeEnabled.value = preferences?.thinkModeEnabled === true;
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

    if (conversationId && conversationId !== currentConversationId.value) {
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
          agentName: agentId,
          toolCalls: [toolCall],
          timestamp: Date.now(),
        });
      });
      return;
    }

    if (agentId) {
      const streaming = streamingMessages.value.get(agentId);
      if (streaming?.role === "assistant") {
        streamingMessages.value.set(agentId, upsertToolCallInMessage(streaming, toolCall));
        streamingMessages.value = new Map(streamingMessages.value);
        return;
      }
    }

    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i];
      if (message.role !== "assistant") {
        continue;
      }
      if (agentId && message.agentId !== agentId) {
        continue;
      }
      messages.value[i] = upsertToolCallInMessage(message, toolCall);
      messages.value = [...messages.value];
      return;
    }

    messages.value.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      agentId,
      agentName: resolveAgentName(agentId),
      toolCalls: [toolCall],
      timestamp: Date.now(),
    });
  }

  function streamKeyFromMessage(msg: ChatMessage): string {
    return msg.agentId ?? msg.id;
  }

  function startStreamingMessage(msg: ChatMessage, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
      mutateRuntimeState(conversationId, (state) => {
        const key = streamKeyFromMessage(msg);
        const existing = state.streamingMessages.get(key);
        if (existing && existing.content.trim().length > 0) {
          state.messages.push(cloneMessage(existing));
        }
        state.streamingMessages.set(key, { ...msg, content: "" });
      });
      return;
    }

    const key = streamKeyFromMessage(msg);
    const existing = streamingMessages.value.get(key);
    if (existing && existing.content.trim().length > 0) {
      messages.value.push({ ...existing });
    }
    streamingMessages.value.set(key, { ...msg, content: "" });
    streamingMessages.value = new Map(streamingMessages.value);
  }

  function appendStreamDelta(agentId: string, delta: string, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
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
      return;
    }

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

  function appendStreamThinkingDelta(agentId: string, delta: string, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
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
      return;
    }

    const current = streamingMessages.value.get(agentId);
    if (!current) {
      return;
    }
    streamingMessages.value.set(agentId, {
      ...current,
      thinking: (current.thinking ?? "") + delta,
    });
    streamingMessages.value = new Map(streamingMessages.value);
  }

  function finalizeStream(agentId?: string, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
      mutateRuntimeState(conversationId, (state) => {
        if (agentId) {
          const stream = state.streamingMessages.get(agentId);
          if (
            stream
            && (
              stream.content.trim().length > 0
              || (typeof stream.thinking === "string" && stream.thinking.trim().length > 0)
              || (Array.isArray(stream.toolCalls) && stream.toolCalls.length > 0)
            )
          ) {
            state.messages.push(cloneMessage(stream));
          }
          state.streamingMessages.delete(agentId);
          return;
        }

        for (const [key, stream] of state.streamingMessages.entries()) {
          if (
            stream.content.trim().length > 0
            || (typeof stream.thinking === "string" && stream.thinking.trim().length > 0)
            || (Array.isArray(stream.toolCalls) && stream.toolCalls.length > 0)
          ) {
            state.messages.push(cloneMessage(stream));
          }
          state.streamingMessages.delete(key);
        }
      });
      return;
    }

    if (agentId) {
      const stream = streamingMessages.value.get(agentId);
      if (
        stream
        && (
          stream.content.trim().length > 0
          || (typeof stream.thinking === "string" && stream.thinking.trim().length > 0)
          || (Array.isArray(stream.toolCalls) && stream.toolCalls.length > 0)
        )
      ) {
        messages.value.push({ ...stream });
      }
      streamingMessages.value.delete(agentId);
      streamingMessages.value = new Map(streamingMessages.value);
      return;
    }

    for (const [key, stream] of streamingMessages.value.entries()) {
      if (
        stream.content.trim().length > 0
        || (typeof stream.thinking === "string" && stream.thinking.trim().length > 0)
        || (Array.isArray(stream.toolCalls) && stream.toolCalls.length > 0)
      ) {
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
    const previousConversationId = currentConversationId.value;
    if (previousConversationId && previousConversationId !== id) {
      persistCurrentRuntimeState();
    }

    currentConversationId.value = id;
    if (id === null) {
      clearMessages();
      applyConversationPreferences(null);
      agentStates.value = new Map();
      isActive.value = false;
      return;
    }

    const restored = restoreRuntimeState(id);
    if (!restored) {
      clearMessages();
      agentStates.value = new Map();
      isActive.value = false;
    }

    const conversation = conversations.value.find((item) => item.id === id);
    if (conversation) {
      applyConversationPreferences(conversation);
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
    const rawCalls = (() => {
      if (Array.isArray(toolCalls)) {
        return toolCalls;
      }
      if (typeof toolCalls === "string") {
        try {
          const parsed = JSON.parse(toolCalls) as unknown;
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          return undefined;
        }
      }
      return undefined;
    })();

    if (!rawCalls) {
      return undefined;
    }

    const normalized = rawCalls
      .map((call, index): ToolCallInfo | null => {
        if (!call || typeof call !== "object") {
          return null;
        }
        const raw = call as Record<string, unknown>;
        const id = typeof raw.id === "string"
          ? raw.id
          : (typeof raw.toolCallId === "string" ? raw.toolCallId : `tool-call-${index}`);
        const name = typeof raw.name === "string"
          ? raw.name
          : (typeof raw.toolName === "string" ? raw.toolName : "tool");
        const args = raw.arguments;
        const normalizedArguments = typeof args === "string"
          ? (() => {
            try {
              return JSON.parse(args);
            } catch {
              return args;
            }
          })()
          : (args ?? {});

        return {
          id,
          name,
          arguments: normalizedArguments,
          result: raw.result,
          isError: typeof raw.isError === "boolean" ? raw.isError : undefined,
        };
      })
      .filter((call): call is ToolCallInfo => call !== null);

    return normalized.length > 0 ? normalized : undefined;
  }

  function parseMetadata(rawMetadata: unknown): Record<string, unknown> | null {
    if (typeof rawMetadata !== "string" || rawMetadata.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawMetadata) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
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
    const rawMetadata = typeof message.metadata === "string" ? message.metadata : undefined;
    const metadata = rawMetadata ? parseMetadata(rawMetadata) : undefined;

    return {
      id,
      role,
      content,
      thinking,
      toolCalls,
      agentId,
      agentName,
      metadata: metadata ?? undefined,
      timestamp,
    };
  }

  function isStandaloneClientToolResult(raw: Record<string, unknown>): boolean {
    const metadata = parseMetadata(raw.metadata);
    const details = metadata?.details;
    const source = (
      details
      && typeof details === "object"
      && !Array.isArray(details)
      && "source" in details
      && typeof (details as Record<string, unknown>).source === "string"
    )
      ? (details as Record<string, unknown>).source as string
      : "";
    if (source === "client_tool") {
      return true;
    }

    const toolName = typeof metadata?.toolName === "string" ? metadata.toolName : "";
    return toolName === "javascript_execute" || toolName === "current_time";
  }

  function normalizeHistoryMessages(rawMessages: unknown[]): ChatMessage[] {
    const normalized: ChatMessage[] = [];
    const toolCallIndex = new Map<string, { messageIndex: number; toolCallIndex: number }>();

    for (const raw of rawMessages) {
      if (!raw || typeof raw !== "object") {
        normalized.push(normalizeHistoryMessage(raw));
        continue;
      }

      const message = raw as Record<string, unknown>;
      const role = normalizeRole(message.role);

      if (role === "tool_result") {
        const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
        if (toolCallId && toolCallIndex.has(toolCallId)) {
          const pointer = toolCallIndex.get(toolCallId)!;
          const targetMessage = normalized[pointer.messageIndex];
          const toolCalls = targetMessage?.toolCalls;
          if (toolCalls && toolCalls[pointer.toolCallIndex]) {
            const metadata = parseMetadata(message.metadata);
            const details = metadata?.details;
            const content = typeof message.content === "string" ? message.content : "";
            const current = toolCalls[pointer.toolCallIndex];

            toolCalls[pointer.toolCallIndex] = {
              ...current,
              name: typeof metadata?.toolName === "string" ? metadata.toolName : current.name,
              isError: typeof metadata?.isError === "boolean" ? metadata.isError : current.isError,
              result: details ?? (content.trim().length > 0 ? content : current.result),
            };
          }
          continue;
        }

        if (isStandaloneClientToolResult(message)) {
          continue;
        }
      }

      const normalizedMessage = normalizeHistoryMessage(message);
      normalized.push(normalizedMessage);

      if (normalizedMessage.role === "assistant" && Array.isArray(normalizedMessage.toolCalls)) {
        normalizedMessage.toolCalls.forEach((toolCall, index) => {
          if (typeof toolCall.id === "string" && toolCall.id.trim().length > 0) {
            toolCallIndex.set(toolCall.id, {
              messageIndex: normalized.length - 1,
              toolCallIndex: index,
            });
          }
        });
      }
    }

    return normalized;
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

  function buildDirectAgentStates(conversation: ConversationInfo): Map<string, AgentState> {
    const directModel = normalizeDirectModel(conversation.directModel);
    if (!directModel) {
      return new Map();
    }
    const label = `${directModel.provider}/${directModel.modelId}`;
    const existing = agentStates.value.get("direct-agent");
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

  function populateAgentStatesFromConversation(conversation: ConversationInfo) {
    if (conversation.swarmId.startsWith("__direct_")) {
      agentStates.value = buildDirectAgentStates(conversation);
      return;
    }

    const matchedSwarm = swarmStore.swarms.find((s) => s.id === conversation.swarmId)
      ?? (swarmStore.currentSwarm?.id === conversation.swarmId ? swarmStore.currentSwarm : null);

    if (!matchedSwarm) {
      agentStates.value = new Map();
      return;
    }

    const next = new Map<string, AgentState>();
    const allAgents = [...(matchedSwarm.agents ?? [])];
    if (matchedSwarm.orchestrator) {
      allAgents.push(matchedSwarm.orchestrator);
    }

    for (const agent of allAgents) {
      const existing = agentStates.value.get(agent.id);
      next.set(agent.id, {
        id: agent.id,
        name: agent.name,
        status: existing?.status ?? "idle",
        model: agent.model,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
      });
    }

    agentStates.value = next;
  }

  async function openConversation(id: string) {
    loadingMessages.value = true;
    try {
      const [messagesRes, conversationRes] = await Promise.all([
        conversationsApi.getMessages(id),
        conversationsApi.getConversation(id),
      ]);
      const currentRuntime = runtimeStates.value.get(id);
      const hasActiveRuntime = Boolean(
        currentRuntime && (currentRuntime.isActive || currentRuntime.streamingMessages.size > 0),
      );
      setCurrentConversation(id);
      if (!hasActiveRuntime) {
        messages.value = normalizeHistoryMessages(Array.isArray(messagesRes.data) ? messagesRes.data : []);
        streamingMessages.value = new Map();
        isActive.value = false;
      }
      applyConversationPreferences(conversationRes.data);
      updateConversationInfo(id, conversationRes.data);
      if (conversationRes.data.swarmId.startsWith("__direct_")) {
        swarmStore.selectSwarm(null as any);
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
          swarmStore.selectSwarm(matchedSwarm);
        } else {
          swarmStore.selectSwarm(null as any);
        }
      }
      populateAgentStatesFromConversation(conversationRes.data);
      persistCurrentRuntimeState();
    } finally {
      loadingMessages.value = false;
    }
  }

  function setAgentStatus(agentId: string, status: AgentState["status"], conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
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
      return;
    }

    const current = agentStates.value.get(agentId);
    agentStates.value.set(agentId, {
      id: agentId,
      name: current?.name ?? agentId,
      status,
      model: current?.model,
      description: current?.description,
      systemPrompt: current?.systemPrompt,
    });
    // Trigger reactivity
    agentStates.value = new Map(agentStates.value);
  }

  function setAgentName(agentId: string, name: string, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
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
      return;
    }

    const current = agentStates.value.get(agentId);
    agentStates.value.set(agentId, {
      id: agentId,
      name,
      status: current?.status ?? "idle",
      model: current?.model,
      description: current?.description,
      systemPrompt: current?.systemPrompt,
    });
    agentStates.value = new Map(agentStates.value);
  }

  function setActive(active: boolean, conversationId?: string) {
    if (conversationId && conversationId !== currentConversationId.value) {
      mutateRuntimeState(conversationId, (state) => {
        state.isActive = active;
      });
      return;
    }
    isActive.value = active;
  }

  async function fetchConversations(swarmId: string) {
    loading.value = true;
    try {
      const res = await conversationsApi.listConversations(swarmId);
      conversations.value = res.data;
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

  async function deleteConversation(id: string) {
    await conversationsApi.deleteConversation(id);
    conversations.value = conversations.value.filter((conv) => conv.id !== id);
    runtimeStates.value.delete(id);
    runtimeStates.value = new Map(runtimeStates.value);
    if (currentConversationId.value === id) {
      setCurrentConversation(null);
      isActive.value = false;
    }
  }

  async function clearCurrentConversationContext() {
    const conversationId = currentConversationId.value;
    if (!conversationId) {
      throw new Error("当前没有可清空上下文的会话");
    }

    const res = await conversationsApi.clearConversationContext(conversationId);

    if (streamingMessages.value.size > 0) {
      finalizeStream(undefined, conversationId);
    }

    if (agentStates.value.size > 0) {
      const next = new Map<string, AgentState>();
      for (const [agentId, state] of agentStates.value.entries()) {
        next.set(agentId, {
          ...state,
          status: "idle",
        });
      }
      agentStates.value = next;
    }

    if (res.data.markerMessage) {
      const marker = normalizeHistoryMessage(res.data.markerMessage);
      addMessage(marker, conversationId);
    }

    isActive.value = false;
    persistCurrentRuntimeState();
    return res.data;
  }

  async function persistCurrentConversationPreferences(
    patch: Partial<Pick<ConversationInfo, "enabledTools" | "thinkModeEnabled" | "directModel">>,
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

  function setThinkModeEnabled(enabled: boolean, persist = true) {
    thinkModeEnabled.value = enabled;
    if (persist) {
      void persistCurrentConversationPreferences({ thinkModeEnabled: enabled }).catch(() => {
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
    if (typeof raw.thinkModeEnabled === "boolean") {
      patch.thinkModeEnabled = raw.thinkModeEnabled;
      if (isCurrentConversation) {
        thinkModeEnabled.value = raw.thinkModeEnabled;
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
        || patch.thinkModeEnabled !== undefined
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
    currentDirectModel,
    addMessage,
    upsertToolCall,
    startStreamingMessage,
    appendStreamDelta,
    appendStreamThinkingDelta,
    finalizeStream,
    clearMessages,
    setCurrentConversation,
    openConversation,
    setAgentStatus,
    setAgentName,
    setActive,
    fetchConversations,
    fetchAllConversations,
    updateConversationTitle,
    deleteConversation,
    clearCurrentConversationContext,
    isToolEnabled,
    setEnabledTools,
    setClientToolEnabled,
    setThinkModeEnabled,
    setDirectModel,
    applyConversationSettingsFromServer,
  };
});
