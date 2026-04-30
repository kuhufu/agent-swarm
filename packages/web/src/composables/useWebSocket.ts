import { ref } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useInterventionStore } from "../stores/intervention.js";
import type { WSMessage } from "../types/index.js";
import { executeClientTool } from "../tools/client-tools.js";

const ws = ref<WebSocket | null>(null);
const connected = ref(false);
const reconnectAttempts = ref(0);
const maxReconnectAttempts = 10;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;
let lastConversationId: string | null = null;

function conversationIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const raw = payload as Record<string, unknown>;
  return typeof raw.conversationId === "string" ? raw.conversationId : undefined;
}

function resolveTargetConversationId(
  msg: WSMessage,
): string | undefined {
  const topLevelConversationId = typeof msg.conversationId === "string" ? msg.conversationId : undefined;
  const payloadConversationId = conversationIdFromPayload(msg.payload);
  const resolvedConversationId = topLevelConversationId ?? payloadConversationId;
  if (resolvedConversationId) {
    lastConversationId = resolvedConversationId;
    return resolvedConversationId;
  }

  if (msg.type === "prompt_completed" || msg.type === "error") {
    return lastConversationId ?? undefined;
  }

  return undefined;
}

export function useWebSocket() {
  function connect() {
    if (ws.value && (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualClose = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("token")?.trim() || null;
    if (!token) {
      connected.value = false;
      return;
    }
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const url = `${protocol}//${window.location.host}/ws${query}`;

    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
      reconnectAttempts.value = 0;
    };

    ws.value.onclose = (event) => {
      connected.value = false;
      ws.value = null;
      if (event.code === 4401) {
        localStorage.removeItem("token");
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
        return;
      }
      if (!manualClose) {
        scheduleReconnect();
      }
    };

    ws.value.onerror = () => {
      connected.value = false;
    };

    ws.value.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        console.error("Failed to parse WS message");
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectAttempts.value >= maxReconnectAttempts) return;
    if (reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** reconnectAttempts.value, 30000);
    reconnectAttempts.value++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function send(msg: WSMessage) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg));
    }
  }

  function disconnect() {
    manualClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws.value && (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)) {
      ws.value.close();
    }
    ws.value = null;
    connected.value = false;
  }

  /**
   * Dispatch incoming WS messages to the appropriate Pinia store.
   */
  function handleMessage(msg: WSMessage) {
    const conversationStore = useConversationStore();
    const interventionStore = useInterventionStore();
    const targetConversationId = resolveTargetConversationId(msg);

    switch (msg.type) {
      case "connected":
        break;

      case "conversation_created":
        if (targetConversationId) {
          conversationStore.bindDraftToConversation(targetConversationId);
          window.dispatchEvent(new CustomEvent("agent-swarm:conversation-created", {
            detail: { conversationId: targetConversationId },
          }));
        }
        conversationStore.applyConversationSettingsFromServer(msg.payload);
        void conversationStore.fetchAllConversations();
        break;

      // ── Agent lifecycle events ──
      case "agent_start":
        conversationStore.setAgentStatus(msg.payload.agentId, "thinking", targetConversationId);
        if (msg.payload.agentName) {
          conversationStore.setAgentName(msg.payload.agentId, msg.payload.agentName, targetConversationId);
        }
        // Direct conversation: populate agent model from conversation preferences
        if (targetConversationId) {
          const directModel = conversationStore.getDirectModel(targetConversationId);
          if (directModel) {
            conversationStore.setAgentModel(msg.payload.agentId, directModel, targetConversationId);
          }
        }
        break;

      case "agent_end":
        conversationStore.setAgentStatus(msg.payload.agentId, "idle", targetConversationId);
        break;

      // ── Message events ──
      case "message_start":
        if (msg.payload.role === "assistant") {
          const rawAgentName = typeof msg.payload.agentName === "string" ? msg.payload.agentName.trim() : "";
          const explicitAgentName = rawAgentName.length > 0 ? rawAgentName : undefined;
          if (msg.payload.agentId && explicitAgentName) {
            conversationStore.setAgentName(msg.payload.agentId, explicitAgentName, targetConversationId);
          }
          const streamAgentName = explicitAgentName
            ?? (
              typeof msg.payload.agentId === "string"
                ? conversationStore.getAgentStates(targetConversationId).get(msg.payload.agentId)?.name
                : undefined
            )
            ?? msg.payload.agentId;
          conversationStore.startStreamingMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            agentId: msg.payload.agentId,
            agentName: streamAgentName,
            timestamp: Date.now(),
          }, targetConversationId);
        }
        break;

      case "message_update":
        if (typeof msg.payload?.agentId === "string") {
          if (typeof msg.payload?.delta === "string") {
            conversationStore.appendStreamDelta(msg.payload.agentId, msg.payload.delta, targetConversationId);
          }
          if (typeof msg.payload?.thinkingDelta === "string") {
            conversationStore.appendStreamThinkingDelta(msg.payload.agentId, msg.payload.thinkingDelta, targetConversationId);
          }
        }
        break;

      case "message_end":
        if (msg.payload?.role === "assistant" && typeof msg.payload?.agentId === "string") {
          conversationStore.finalizeStream(msg.payload.agentId, targetConversationId);
        }
        break;

      // ── Tool execution events ──
      case "tool_execution_start":
        conversationStore.setAgentStatus(msg.payload.agentId, "executing_tool", targetConversationId);
        if (typeof msg.payload?.toolCallId === "string" && typeof msg.payload?.toolName === "string") {
          conversationStore.upsertToolCall(msg.payload.agentId, {
            id: msg.payload.toolCallId,
            name: msg.payload.toolName,
            arguments: msg.payload?.args,
          }, targetConversationId);
        }
        break;

      case "tool_execution_end": {
        conversationStore.setAgentStatus(msg.payload.agentId, "thinking", targetConversationId);
        if (typeof msg.payload?.toolCallId === "string" && typeof msg.payload?.toolName === "string") {
          conversationStore.upsertToolCall(msg.payload.agentId, {
            id: msg.payload.toolCallId,
            name: msg.payload.toolName,
            arguments: msg.payload?.args,
            result: msg.payload?.result,
            isError: msg.payload.isError === true,
          }, targetConversationId);
        }
        break;
      }

      // ── Handoff event ──
      case "handoff":
        conversationStore.setAgentStatus(msg.payload.fromAgentId, "idle", targetConversationId);
        conversationStore.setAgentStatus(msg.payload.toAgentId, "thinking", targetConversationId);
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "notification",
          content: `🔄 Agent 交接: ${msg.payload.fromAgentId} → ${msg.payload.toAgentId}`,
          timestamp: Date.now(),
        }, targetConversationId);
        break;

      // ── Intervention events ──
      case "intervention_required":
        interventionStore.addIntervention({
          requestId: msg.payload.requestId,
          point: msg.payload.point,
          context: msg.payload.context,
          timestamp: Date.now(),
        });
        break;

      case "client_tool_execution_required":
        void handleClientToolExecutionRequired(msg, conversationStore, targetConversationId);
        break;

      // ── Swarm lifecycle ──
      case "swarm_start":
        conversationStore.setActive(true, targetConversationId);
        break;

      case "swarm_end":
        conversationStore.setActive(false, targetConversationId);
        if (msg.payload.finalMessage) {
          conversationStore.addMessage({
            id: crypto.randomUUID(),
            role: "notification",
            content: msg.payload.finalMessage,
            timestamp: Date.now(),
          }, targetConversationId);
        }
        break;

      case "prompt_completed":
        conversationStore.setActive(false, targetConversationId);
        break;

      // ── Error ──
      case "error":
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "system",
          content: `Error: ${msg.payload.message ?? "Unknown error"}`,
          timestamp: Date.now(),
        }, targetConversationId);
        conversationStore.setActive(false, targetConversationId);
        break;
    }
  }

  async function handleClientToolExecutionRequired(
    msg: WSMessage,
    conversationStore: ReturnType<typeof useConversationStore>,
    conversationId: string | undefined,
  ) {
    const payload = msg.payload ?? {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "";
    const params = payload.params as Record<string, unknown> | undefined;

    if (!requestId) {
      return;
    }

    const executed = await executeClientTool(
      toolName,
      params,
      { enabledTools: conversationStore.getEnabledTools(conversationId) },
    );

    send({
      type: "client_tool_result",
      payload: {
        requestId,
        result: {
          isError: executed.isError,
          content: executed.content,
          details: executed.details,
        },
      },
    });
  }

  return { ws, connected, connect, disconnect, send };
}
