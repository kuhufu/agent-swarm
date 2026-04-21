<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useConversationStore } from "../../stores/conversation.js";
import { useSwarmStore } from "../../stores/swarm.js";
import type { ConversationInfo } from "../../types/index.js";

const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();
const emit = defineEmits<{
  (e: "select", conv: ConversationInfo): void;
  (e: "new"): void;
}>();

onMounted(() => {
  if (swarmStore.currentSwarm) {
    conversationStore.fetchConversations(swarmStore.currentSwarm.id);
  }
});

function selectConversation(conv: ConversationInfo) {
  conversationStore.setCurrentConversation(conv.id);
  emit("select", conv);
}

function createNew() {
  conversationStore.setCurrentConversation(null);
  emit("new");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-header">
      <t-button size="small" theme="default" block @click="createNew">新建对话</t-button>
    </div>
    <div class="conversation-list">
      <div
        v-for="conv in conversationStore.conversations"
        :key="conv.id"
        class="conversation-item"
        :class="{ active: conv.id === conversationStore.currentConversationId }"
        @click="selectConversation(conv)"
      >
        <span class="conv-title">{{ conv.title ?? "新对话" }}</span>
        <span class="conv-time">{{ formatTime(conv.updatedAt) }}</span>
      </div>
      <div v-if="conversationStore.conversations.length === 0" class="empty">
        暂无对话
      </div>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 260px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.conversation-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conversation-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.conversation-item.active {
  background: rgba(99, 102, 241, 0.12);
}

.conv-title {
  color: #c0c0c0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.conv-time {
  color: #666;
  font-size: 12px;
  margin-left: 8px;
  white-space: nowrap;
}

.empty {
  text-align: center;
  padding: 24px 0;
  color: #666;
  font-size: 14px;
}
</style>
