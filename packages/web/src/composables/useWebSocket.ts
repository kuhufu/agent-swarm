import { ref } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useInterventionStore } from "../stores/intervention.js";
import { useSwarmStore } from "../stores/swarm.js";
import type { WSMessage } from "../types/index.js";
import { executeClientTool } from "../tools/client-tools.js";

const ws = ref<WebSocket | null>(null);
const connected = ref(false);
const reconnectAttempts = ref(0);
const maxReconnectAttempts = 10;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;

export function useWebSocket() {
  function connect() {
    if (ws.value && (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualClose = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
      reconnectAttempts.value = 0;
    };

    ws.value.onclose = () => {
      connected.value = false;
      ws.value = null;
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
    const swarmStore = useSwarmStore();

    switch (msg.type) {
      case "connected":
        break;

      case "conversation_created":
        conversationStore.setCurrentConversation(msg.payload.conversationId);
        if (swarmStore.currentSwarm?.id) {
          void conversationStore.fetchConversations(swarmStore.currentSwarm.id);
        }
        break;

      // ── Agent lifecycle events ──
      case "agent_start":
        conversationStore.setAgentStatus(msg.payload.agentId, "thinking");
        if (msg.payload.agentName) {
          conversationStore.setAgentName(msg.payload.agentId, msg.payload.agentName);
        }
        break;

      case "agent_end":
        conversationStore.setAgentStatus(msg.payload.agentId, "idle");
        break;

      // ── Message events ──
      case "message_start":
        if (msg.payload.role === "assistant") {
          const fallbackName = msg.payload.agentName
            ?? conversationStore.agentStates.get(msg.payload.agentId)?.name
            ?? msg.payload.agentId;
          if (msg.payload.agentId && fallbackName) {
            conversationStore.setAgentName(msg.payload.agentId, fallbackName);
          }
          conversationStore.startStreamingMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            agentId: msg.payload.agentId,
            agentName: fallbackName,
            timestamp: Date.now(),
          });
        }
        break;

      case "message_update":
        if (typeof msg.payload?.agentId === "string" && typeof msg.payload?.delta === "string") {
          conversationStore.appendStreamDelta(msg.payload.agentId, msg.payload.delta);
        }
        break;

      case "message_end":
        if (msg.payload?.role === "assistant" && typeof msg.payload?.agentId === "string") {
          conversationStore.finalizeStream(msg.payload.agentId);
        }
        break;

      // ── Tool execution events ──
      case "tool_execution_start":
        conversationStore.setAgentStatus(msg.payload.agentId, "executing_tool");
        if (typeof msg.payload?.toolCallId === "string" && typeof msg.payload?.toolName === "string") {
          conversationStore.upsertToolCall(msg.payload.agentId, {
            id: msg.payload.toolCallId,
            name: msg.payload.toolName,
            arguments: msg.payload?.args,
          });
        }
        break;

      case "tool_execution_end": {
        conversationStore.setAgentStatus(msg.payload.agentId, "thinking");
        if (typeof msg.payload?.toolCallId === "string" && typeof msg.payload?.toolName === "string") {
          conversationStore.upsertToolCall(msg.payload.agentId, {
            id: msg.payload.toolCallId,
            name: msg.payload.toolName,
            arguments: msg.payload?.args,
            result: msg.payload?.result,
            isError: msg.payload.isError === true,
          });
        }
        break;
      }

      // ── Handoff event ──
      case "handoff":
        conversationStore.setAgentStatus(msg.payload.fromAgentId, "idle");
        conversationStore.setAgentStatus(msg.payload.toAgentId, "thinking");
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "notification",
          content: `🔄 Agent 交接: ${msg.payload.fromAgentId} → ${msg.payload.toAgentId}`,
          timestamp: Date.now(),
        });
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
        void handleClientToolExecutionRequired(msg, conversationStore);
        break;

      // ── Swarm lifecycle ──
      case "swarm_start":
        conversationStore.setActive(true);
        break;

      case "swarm_end":
        conversationStore.setActive(false);
        if (msg.payload.finalMessage) {
          conversationStore.addMessage({
            id: crypto.randomUUID(),
            role: "notification",
            content: msg.payload.finalMessage,
            timestamp: Date.now(),
          });
        }
        break;

      case "prompt_completed":
        conversationStore.setActive(false);
        if (conversationStore.currentConversationId) {
          void conversationStore.openConversation(conversationStore.currentConversationId);
        }
        break;

      // ── Error ──
      case "error":
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "system",
          content: `Error: ${msg.payload.message ?? "Unknown error"}`,
          timestamp: Date.now(),
        });
        conversationStore.setActive(false);
        break;
    }
  }

  async function handleClientToolExecutionRequired(
    msg: WSMessage,
    conversationStore: ReturnType<typeof useConversationStore>,
  ) {
    const payload = msg.payload ?? {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "";
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
    const params = payload.params as Record<string, unknown> | undefined;

    if (!requestId) {
      return;
    }

    if (toolCallId && toolName) {
      conversationStore.upsertToolCall(undefined, {
        id: toolCallId,
        name: toolName,
        arguments: params ?? {},
      });
    }

    const executed = await executeClientTool(
      toolName,
      params,
      { jsExecutionToolEnabled: conversationStore.jsExecutionToolEnabled },
    );
    if (toolCallId && toolName) {
      conversationStore.upsertToolCall(undefined, {
        id: toolCallId,
        name: toolName,
        arguments: params ?? {},
        result: executed.details ?? executed.content,
        isError: executed.isError,
      });
    }

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
