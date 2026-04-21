<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import type { ConversationInfo, SwarmConfig } from "../types/index.js";

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

function getSwarmName(swarmId: string): string {
  return swarmStore.swarms.find((s: SwarmConfig) => s.id === swarmId)?.name ?? swarmId;
}

function getSwarmColor(swarmId: string): string {
  const colors = [
    "rgba(99, 102, 241, 0.15)",
    "rgba(52, 211, 153, 0.15)",
    "rgba(96, 165, 250, 0.15)",
    "rgba(251, 191, 36, 0.15)",
    "rgba(248, 113, 113, 0.15)",
  ];
  let hash = 0;
  for (let i = 0; i < swarmId.length; i++) {
    hash = swarmId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
</script>

<template>
  <div class="history-view page-container">
    <div class="history-header">
      <div>
        <h2 class="section-title">历史对话</h2>
        <p class="section-desc">查看和管理所有历史对话记录</p>
      </div>
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchQuery"
          class="input-field"
          placeholder="搜索对话..."
        />
      </div>
    </div>

    <div class="history-list">
      <div
        v-for="conv in filteredConversations"
        :key="conv.id"
        class="history-item card"
      >
        <div class="history-main">
          <div class="history-title-row">
            <h4 class="history-title">{{ conv.title ?? "新对话" }}</h4>
            <span class="history-time">{{ formatTime(conv.updatedAt) }}</span>
          </div>
          <div class="history-meta">
            <span class="swarm-badge" :style="{ background: getSwarmColor(conv.swarmId) }">
              {{ getSwarmName(conv.swarmId) }}
            </span>
            <span class="conv-id">{{ conv.id.slice(0, 8) }}</span>
          </div>
        </div>
        <div class="history-actions">
          <button class="action-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="filteredConversations.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p class="empty-title">{{ searchQuery ? "未找到匹配的对话" : "暂无历史对话" }}</p>
        <p v-if="!searchQuery" class="empty-desc">开始对话后，历史记录将显示在这里</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  height: 100%;
  overflow-y: auto;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
  gap: 16px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin: 4px 0 0;
}

.search-box {
  position: relative;
  width: 280px;
  flex-shrink: 0;
}

.search-box input {
  padding-left: 40px;
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
}

.history-main {
  flex: 1;
  min-width: 0;
}

.history-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.history-title {
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  color: var(--color-text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.swarm-badge {
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.conv-id {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.history-actions {
  display: flex;
  gap: 6px;
  margin-left: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.history-item:hover .history-actions {
  opacity: 1;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 0;
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
  margin-bottom: 16px;
}

.empty-icon svg {
  width: 28px;
  height: 28px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: 14px;
  margin: 0;
}
</style>
