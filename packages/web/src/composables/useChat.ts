import { computed, ref, watch } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "./useWebSocket.js";
import { buildClientToolDefinitions } from "../tools/client-tools.js";

export interface DirectModelSelection {
  provider: string;
  modelId: string;
}

export function useChat() {
  const conversationStore = useConversationStore();
  const { send, connected, connect } = useWebSocket();
  const inputText = ref("");
  const sending = ref(false);
  const directModel = ref<DirectModelSelection | null>(null);
  const currentTimeToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("current_time"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("current_time", value),
  });
  const jsExecutionToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("javascript_execute"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("javascript_execute", value),
  });
  const thinkModeEnabled = computed({
    get: () => conversationStore.thinkModeEnabled,
    set: (value: boolean) => conversationStore.setThinkModeEnabled(value),
  });

  // Sync sending state with isActive from the store.
  // When the WS handler sets isActive=false (swarm_end/prompt_completed/error),
  // sending should also be reset so the input is re-enabled.
  watch(() => conversationStore.isActive, (active) => {
    if (!active) {
      sending.value = false;
    }
  });

  /** Send message in swarm mode */
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
      enabledTools: conversationStore.enabledTools,
    });

    if (conversationId) {
      send({
        type: "send_message",
        payload: {
          conversationId,
          content: text,
          clientTools,
          enabledTools: conversationStore.enabledTools,
          thinkModeEnabled: conversationStore.thinkModeEnabled,
        },
      });
    } else {
      send({
        type: "send_message",
        payload: {
          swarmId,
          content: text,
          clientTools,
          enabledTools: conversationStore.enabledTools,
          thinkModeEnabled: conversationStore.thinkModeEnabled,
        },
      });
    }

    inputText.value = "";
  }

  /** Send message in direct chat mode (no swarm) */
  function sendDirectMessage() {
    const text = inputText.value.trim();
    if (!text || sending.value || !connected.value || !directModel.value) return;

    sending.value = true;
    conversationStore.setActive(true);

    conversationStore.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    const conversationId = conversationStore.currentConversationId;
    const clientTools = buildClientToolDefinitions({
      enabledTools: conversationStore.enabledTools,
    });

    send({
      type: "send_message",
      payload: {
        conversationId: conversationId ?? undefined,
        provider: directModel.value.provider,
        modelId: directModel.value.modelId,
        content: text,
        clientTools,
        enabledTools: conversationStore.enabledTools,
        thinkModeEnabled: conversationStore.thinkModeEnabled,
      },
    });

    inputText.value = "";
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

  return {
    inputText,
    sending,
    connected,
    connect,
    sendMessage,
    sendDirectMessage,
    abort,
    directModel,
    currentTimeToolEnabled,
    jsExecutionToolEnabled,
    thinkModeEnabled,
  };
}
