import { computed, ref, watch } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "./useWebSocket.js";
import { buildClientToolDefinitions } from "../tools/client-tools.js";

export function useChat() {
  const conversationStore = useConversationStore();
  const { send, connected, connect } = useWebSocket();
  const inputText = ref("");
  const sending = ref(false);
  const jsExecutionToolEnabled = computed({
    get: () => conversationStore.jsExecutionToolEnabled,
    set: (value: boolean) => conversationStore.setJsExecutionToolEnabled(value),
  });

  // Sync sending state with isActive from the store.
  // When the WS handler sets isActive=false (swarm_end/prompt_completed/error),
  // sending should also be reset so the input is re-enabled.
  watch(() => conversationStore.isActive, (active) => {
    if (!active) {
      sending.value = false;
    }
  });

  function sendMessage(swarmId: string) {
    const text = inputText.value.trim();
    if (!text || sending.value || !connected.value) return;

    sending.value = true;
    conversationStore.setActive(true);

    // Add user message to store
    conversationStore.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    // Send via WebSocket — create new conversation or use existing
    const conversationId = conversationStore.currentConversationId;
    const clientTools = buildClientToolDefinitions({
      jsExecutionToolEnabled: conversationStore.jsExecutionToolEnabled,
    });

    if (conversationId) {
      send({
        type: "send_message",
        payload: {
          conversationId,
          content: text,
          clientTools,
        },
      });
    } else {
      send({
        type: "send_message",
        payload: {
          swarmId,
          content: text,
          clientTools,
        },
      });
    }

    inputText.value = "";
    // Note: sending remains true until prompt_completed event from server
    // The WS handler will set isActive to false
  }

  function abort() {
    if (conversationStore.currentConversationId) {
      send({
        type: "abort",
        payload: { conversationId: conversationStore.currentConversationId },
      });
    }
    conversationStore.setActive(false);
    sending.value = false;
  }

  return { inputText, sending, connected, connect, sendMessage, abort, jsExecutionToolEnabled };
}
