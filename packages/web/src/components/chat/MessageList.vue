<script setup lang="ts">
import type { ChatMessage } from "../../types/index.js";
import MessageItem from "./MessageItem.vue";

defineProps<{
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
}>();
</script>

<template>
  <div class="message-list">
    <div v-if="messages.length === 0 && !streamingMessage" class="empty-state">
      <p>开始新的对话</p>
    </div>
    <MessageItem
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
    />
    <MessageItem
      v-if="streamingMessage"
      :message="streamingMessage"
      :streaming="true"
    />
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}
</style>
