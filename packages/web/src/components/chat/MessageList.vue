<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../../types/index.js";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
}>();

const visibleMessages = computed(() =>
  props.messages.filter((msg) => {
    if (msg.role !== "assistant") {
      return true;
    }
    const hasText = msg.content.trim().length > 0;
    const hasThinking = typeof msg.thinking === "string" && msg.thinking.trim().length > 0;
    const hasToolCalls = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
    return hasText || hasThinking || hasToolCalls;
  }),
);
</script>

<template>
  <div class="message-list">
    <div v-if="visibleMessages.length === 0 && !streamingMessage" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p class="empty-title">开始新的对话</p>
      <p class="empty-desc">选择一个 Swarm 并发送消息开始协作</p>
    </div>
    <div v-else class="messages-container">
      <MessageItem
        v-for="msg in visibleMessages"
        :key="msg.id"
        :message="msg"
      />
      <MessageItem
        v-if="streamingMessage"
        :message="streamingMessage"
        :streaming="true"
      />
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
}

.empty-icon svg {
  width: 28px;
  height: 28px;
  color: var(--color-text-muted);
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0;
}

.empty-desc {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

.messages-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 900px;
  margin: 0 auto;
}
</style>
