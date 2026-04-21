<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import type { ConversationInfo, SwarmConfig } from "../types/index.js";
import * as conversationsApi from "../api/conversations.js";

const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();
const searchQuery = ref("");

const filteredConversations = computed(() => {
  if (!searchQuery.value) return conversationStore.conversations;
  const q = searchQuery.value.toLowerCase();
  return conversationStore.conversations.filter(
    (c: ConversationInfo) => c.title?.toLowerCase().includes(q),
  );
});

onMounted(async () => {
  // Load all conversations across swarms
  for (const swarm of swarmStore.swarms) {
    try {
      await conversationStore.fetchConversations(swarm.id);
    } catch { /* ignore */ }
  }
});

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const emit = defineEmits<{
  (e: "resume", conv: ConversationInfo): void;
}>();

function resumeConversation(conv: ConversationInfo) {
  emit("resume", conv);
}
</script>

<template>
  <div class="history-view">
    <div class="history-header">
      <h2>历史对话</h2>
      <t-input
        v-model="searchQuery"
        placeholder="搜索对话..."
        clearable
      />
    </div>
    <div class="history-list">
      <div
        v-for="conv in filteredConversations"
        :key="conv.id"
        class="history-item"
        @click="resumeConversation(conv)"
      >
        <div class="history-item-main">
          <span class="history-title">{{ conv.title ?? "新对话" }}</span>
          <span class="history-time">{{ formatTime(conv.updatedAt) }}</span>
        </div>
        <div class="history-item-meta">
          <span class="history-swarm">{{ swarmStore.swarms.find((s: SwarmConfig) => s.id === conv.swarmId)?.name ?? conv.swarmId }}</span>
        </div>
      </div>
      <div v-if="filteredConversations.length === 0" class="empty-state">
        <p>{{ searchQuery ? "未找到匹配的对话" : "暂无历史对话" }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  padding: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  gap: 16px;
}

.history-header h2 {
  color: #e0e0e0;
  margin: 0;
  white-space: nowrap;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.3);
}

.history-item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.history-title {
  color: #e0e0e0;
  font-size: 15px;
  font-weight: 500;
}

.history-time {
  color: #666;
  font-size: 13px;
}

.history-item-meta {
  display: flex;
  gap: 12px;
}

.history-swarm {
  color: #888;
  font-size: 13px;
}

.empty-state {
  text-align: center;
  padding: 64px 0;
  color: #888;
}
</style>
