<script setup lang="ts">
import { onMounted } from "vue";
import { useChat } from "../../composables/useChat.js";

const props = defineProps<{
  swarmId: string;
  active?: boolean;
}>();

const { inputText, sending, connected, connect, sendMessage, abort } = useChat();

function handleSend() {
  if (props.active) {
    abort();
  } else {
    sendMessage(props.swarmId);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!props.active) {
      sendMessage(props.swarmId);
    }
  }
}

onMounted(() => {
  if (!connected.value) {
    connect();
  }
});
</script>

<template>
  <div class="chat-input">
    <div class="input-wrapper">
      <textarea
        v-model="inputText"
        placeholder="输入消息..."
        rows="1"
        :disabled="sending || !swarmId"
        @keydown="handleKeydown"
      />
      <t-button
        v-if="!active"
        theme="primary"
        size="small"
        :disabled="!swarmId || sending || !inputText.trim()"
        @click="sendMessage(swarmId)"
      >
        发送
      </t-button>
      <t-button
        v-else
        theme="danger"
        size="small"
        @click="abort"
      >
        停止
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
