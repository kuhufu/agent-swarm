import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, ConversationInfo } from "../types/index.js";

export const useConversationStore = defineStore("conversation", () => {
  const conversations = ref<ConversationInfo[]>([]);
  const currentConversationId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const streamingMessage = ref<ChatMessage | null>(null);
  const loading = ref(false);

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function appendStreamDelta(delta: string) {
    if (streamingMessage.value) {
      streamingMessage.value.content += delta;
    }
  }

  function finalizeStream() {
    if (streamingMessage.value) {
      messages.value.push({ ...streamingMessage.value });
      streamingMessage.value = null;
    }
  }

  function clearMessages() {
    messages.value = [];
    streamingMessage.value = null;
  }

  return {
    conversations,
    currentConversationId,
    messages,
    streamingMessage,
    loading,
    addMessage,
    appendStreamDelta,
    finalizeStream,
    clearMessages,
  };
});
