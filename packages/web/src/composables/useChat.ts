import { ref } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "./useWebSocket.js";

export function useChat() {
  const conversationStore = useConversationStore();
  const { send, connected, connect } = useWebSocket();
  const inputText = ref("");
  const sending = ref(false);

  function sendMessage(conversationId: string) {
    const text = inputText.value.trim();
    if (!text || sending.value) return;

    sending.value = true;

    // Add user message to store
    conversationStore.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    // Send via WebSocket
    send({
      type: "send_message",
      payload: { content: text },
      conversationId,
    });

    inputText.value = "";
    sending.value = false;
  }

  return { inputText, sending, connected, connect, sendMessage };
}
