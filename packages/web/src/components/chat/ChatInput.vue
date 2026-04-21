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
      <div class="textarea-wrapper">
        <textarea
          v-model="inputText"
          placeholder="输入消息..."
          rows="1"
          :disabled="sending || !swarmId"
          @keydown="handleKeydown"
        />
        <span v-if="!swarmId" class="input-hint">请先选择一个 Swarm</span>
      </div>
      <button
        v-if="!active"
        class="send-btn"
        :disabled="!swarmId || sending || !inputText.trim()"
        @click="sendMessage(swarmId)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
      <button
        v-else
        class="send-btn stop"
        @click="abort"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  padding: 16px 24px 24px;
  border-top: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
}

.input-wrapper {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  max-width: 900px;
  margin: 0 auto;
}

.textarea-wrapper {
  flex: 1;
  position: relative;
}

textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  padding: 12px 16px;
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 48px;
  max-height: 160px;
  line-height: 1.6;
  transition: all 0.2s;
}

textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

textarea::placeholder {
  color: var(--color-text-muted);
}

textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.send-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

.send-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px var(--color-accent-glow);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn.stop {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.send-btn.stop:hover {
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
}

.send-btn svg {
  width: 18px;
  height: 18px;
}
</style>
