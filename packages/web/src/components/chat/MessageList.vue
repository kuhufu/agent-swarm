<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../../types/index.js";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessages: ChatMessage[];
  isDirectMode?: boolean;
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

interface RenderEntry {
  message: ChatMessage;
  streaming: boolean;
}

const renderEntries = computed<RenderEntry[]>(() => {
  const byId = new Map<string, RenderEntry>();

  for (const msg of visibleMessages.value) {
    byId.set(msg.id, { message: msg, streaming: false });
  }

  for (const msg of props.streamingMessages) {
    byId.set(msg.id, { message: msg, streaming: true });
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.message.timestamp !== b.message.timestamp) {
      return a.message.timestamp - b.message.timestamp;
    }
    return a.message.id.localeCompare(b.message.id);
  });
});
</script>

<template>
  <div class="message-list">
    <div v-if="renderEntries.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p class="empty-title">{{ isDirectMode ? '选择模型开始对话' : '开始新的对话' }}</p>
      <p class="empty-desc">{{ isDirectMode ? '在下方选择提供商和模型，然后发送消息' : '选择一个 Swarm 并发送消息开始协作' }}</p>
    </div>
    <div v-else class="messages-container">
      <MessageItem
        v-for="entry in renderEntries"
        :key="entry.message.id"
        :message="entry.message"
        :streaming="entry.streaming"
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
