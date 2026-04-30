import { computed, ref, watch, type Ref } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "./useWebSocket.js";
import { showError } from "../utils/ui-feedback.js";

export interface DirectModelSelection {
  provider: string;
  modelId: string;
}

export function useChat(conversationId: Ref<string | null>) {
  const conversationStore = useConversationStore();
  const { send, connected, connect } = useWebSocket();
  const inputText = ref("");
  const sending = ref(false);
  const draftDirectModel = ref<DirectModelSelection | null>(null);
  const directModel = computed<DirectModelSelection | null>({
    get: (): DirectModelSelection | null => {
      const model = conversationStore.getDirectModel(conversationId.value) ?? draftDirectModel.value;
      if (!model) {
        return null;
      }
      return {
        provider: model.provider,
        modelId: model.modelId,
      };
    },
    set: (value: DirectModelSelection | null): void => {
      if (conversationId.value) {
        conversationStore.setDirectModel(conversationId.value, value, true);
        return;
      }
      draftDirectModel.value = value;
    },
  });
  const currentTimeToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("current_time"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("current_time", value),
  });
  const jsExecutionToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("javascript_execute"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("javascript_execute", value),
  });
  const searchToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("web_search"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("web_search", value),
  });
  const retrieveKnowledgeToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("retrieve_knowledge"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("retrieve_knowledge", value),
  });
  const workspaceToolEnabled = computed({
    get: () => conversationStore.isToolEnabled("workspace"),
    set: (value: boolean) => conversationStore.setClientToolEnabled("workspace", value),
  });
  const thinkingLevel = computed({
    get: () => conversationStore.thinkingLevel,
    set: (value: string) => conversationStore.setThinkingLevel(value),
  });

  // Sync sending state with isActive from the store.
  // When the WS handler sets isActive=false (swarm_end/prompt_completed/error),
  // sending should also be reset so the input is re-enabled.
  watch(() => conversationStore.getIsActive(conversationId.value), (active) => {
    if (!active) {
      sending.value = false;
    }
  });

  /** Send message in swarm mode */
  function sendMessage(swarmId: string) {
    const text = inputText.value.trim();
    if (!text || sending.value || !connected.value) return;

    sending.value = true;
    const runtimeConversationId = conversationId.value ?? undefined;
    conversationStore.setActive(true, runtimeConversationId);

    // Add user message to store
    conversationStore.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    }, runtimeConversationId);

    // Send via WebSocket — create new conversation or use existing
    const activeConversationId = conversationId.value;

    if (activeConversationId) {
      send({
        type: "send_message",
        payload: {
          conversationId: activeConversationId,
          content: text,
          enabledTools: conversationStore.enabledTools,
          thinkingLevel: thinkingLevel.value,
        },
      });
    } else {
      send({
        type: "send_message",
        payload: {
          swarmId,
          content: text,
          enabledTools: conversationStore.enabledTools,
          thinkingLevel: thinkingLevel.value,
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
    const runtimeConversationId = conversationId.value ?? undefined;
    conversationStore.setActive(true, runtimeConversationId);

    conversationStore.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    }, runtimeConversationId);

    send({
      type: "send_message",
      payload: {
        conversationId: conversationId.value ?? undefined,
        provider: directModel.value.provider,
        modelId: directModel.value.modelId,
        content: text,
        enabledTools: conversationStore.enabledTools,
        thinkingLevel: thinkingLevel.value,
      },
    });

    inputText.value = "";
  }

  function abort() {
    if (conversationId.value) {
      send({
        type: "abort",
        payload: { conversationId: conversationId.value },
      });
    }
    conversationStore.setActive(false, conversationId.value ?? undefined);
    sending.value = false;
  }

  const canClearContext = computed(() =>
    Boolean(conversationId.value) && !conversationStore.getIsActive(conversationId.value) && !sending.value,
  );

  async function clearContext() {
    if (!canClearContext.value) {
      return false;
    }

    try {
      await conversationStore.clearConversationContext(conversationId.value);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "清空上下文失败";
      showError(message);
      return false;
    }
  }

  return {
    inputText,
    sending,
    connected,
    connect,
    sendMessage,
    sendDirectMessage,
    abort,
    canClearContext,
    clearContext,
    directModel,
    currentTimeToolEnabled,
    jsExecutionToolEnabled,
    searchToolEnabled,
    retrieveKnowledgeToolEnabled,
    workspaceToolEnabled,
    thinkingLevel,
  };
}
