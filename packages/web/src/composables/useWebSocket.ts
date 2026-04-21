import { ref, onUnmounted } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useInterventionStore } from "../stores/intervention.js";
import type { WSMessage, ChatMessage, InterventionRequest } from "../types/index.js";

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 10;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
      reconnectAttempts.value = 0;
    };

    ws.value.onclose = () => {
      connected.value = false;
      scheduleReconnect();
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

    const delay = Math.min(1000 * 2 ** reconnectAttempts.value, 30000);
    reconnectAttempts.value++;

    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  function send(msg: WSMessage) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg));
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws.value?.close();
  }

  /**
   * Dispatch incoming WS messages to the appropriate Pinia store.
   */
  function handleMessage(msg: WSMessage) {
    const conversationStore = useConversationStore();
    const interventionStore = useInterventionStore();

    switch (msg.type) {
      case "connected":
        break;

      case "conversation_created":
        conversationStore.setCurrentConversation(msg.payload.conversationId);
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
          conversationStore.startStreamingMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            agentId: msg.payload.agentId,
            agentName: msg.payload.agentName,
            timestamp: Date.now(),
          });
        }
        break;

      case "message_update":
        if (msg.payload.delta) {
          conversationStore.appendStreamDelta(msg.payload.delta);
        }
        break;

      case "message_end":
        conversationStore.finalizeStream();
        break;

      // ── Tool execution events ──
      case "tool_execution_start":
        conversationStore.setAgentStatus(msg.payload.agentId, "executing_tool");
        // Add tool call notification to messages
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "notification",
          content: `🔧 执行工具: ${msg.payload.toolName}`,
          timestamp: Date.now(),
        });
        break;

      case "tool_execution_end": {
        const isError = msg.payload.isError;
        conversationStore.setAgentStatus(msg.payload.agentId, "thinking");
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: "notification",
          content: isError
            ? `❌ 工具执行失败: ${msg.payload.toolName}`
            : `✅ 工具执行完成: ${msg.payload.toolName}`,
          timestamp: Date.now(),
        });
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

  onUnmounted(() => {
    disconnect();
  });

  return { ws, connected, connect, disconnect, send };
}
