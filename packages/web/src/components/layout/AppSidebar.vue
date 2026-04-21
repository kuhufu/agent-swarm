<script setup lang="ts">
import { useConversationStore } from "../../stores/conversation.js";

const conversationStore = useConversationStore();
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-header">
      <t-button size="small" theme="default" block>新建对话</t-button>
    </div>
    <div class="conversation-list">
      <div
        v-for="conv in conversationStore.conversations"
        :key="conv.id"
        class="conversation-item"
        :class="{ active: conv.id === conversationStore.currentConversationId }"
      >
        <span class="conv-title">{{ conv.title ?? "新对话" }}</span>
        <span class="conv-time">{{ new Date(conv.updatedAt).toLocaleDateString() }}</span>
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
}

.empty {
  text-align: center;
  padding: 24px 0;
  color: #666;
  font-size: 14px;
}
</style>
