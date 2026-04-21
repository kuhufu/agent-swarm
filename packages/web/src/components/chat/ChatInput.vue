<script setup lang="ts">
import { useChat } from "../../composables/useChat.js";

const props = defineProps<{
  conversationId: string | null;
}>();

const { inputText, sending, sendMessage } = useChat();

function handleSend() {
  if (props.conversationId) {
    sendMessage(props.conversationId);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}
</script>

<template>
  <div class="chat-input">
    <div class="input-wrapper">
      <textarea
        v-model="inputText"
        placeholder="输入消息..."
        rows="1"
        :disabled="!conversationId || sending"
        @keydown="handleKeydown"
      />
      <t-button
        theme="primary"
        size="small"
        :disabled="!conversationId || sending || !inputText.trim()"
        @click="handleSend"
      >
        发送
      </t-button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.input-wrapper {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px 14px;
  color: #e0e0e0;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 40px;
  max-height: 120px;
}

textarea:focus {
  border-color: rgba(99, 102, 241, 0.5);
}

textarea::placeholder {
  color: #666;
}

textarea:disabled {
  opacity: 0.5;
}
</style>
