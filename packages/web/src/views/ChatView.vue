<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "../composables/useWebSocket.js";
import MessageList from "../components/chat/MessageList.vue";
import ChatInput from "../components/chat/ChatInput.vue";
import AgentStatus from "../components/chat/AgentStatus.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";

const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const { connect, connected } = useWebSocket();

const swarmId = computed(() => swarmStore.currentSwarm?.id ?? "");
const isDirectMode = computed(() => !swarmStore.currentSwarm);
const streamingMessages = computed(() =>
  Array.from(conversationStore.streamingMessages.values()),
);

onMounted(() => {
  swarmStore.fetchSwarms();
  if (!connected.value) {
    connect();
  }
});

function handleNewConversation() {
  conversationStore.setCurrentConversation(null);
}
</script>

<template>
  <div class="chat-view">
    <div class="chat-main">
      <div class="chat-header">
        <div class="chat-header-left">
          <h2>{{ isDirectMode ? '直接对话' : '对话' }}</h2>
          <span v-if="conversationStore.currentConversationId" class="conversation-id">
            {{ conversationStore.currentConversationId.slice(0, 8) }}
          </span>
          <span v-if="isDirectMode" class="mode-badge direct">直接对话模式</span>
        </div>
        <button class="btn-secondary" @click="handleNewConversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新对话
        </button>
      </div>
      <MessageList
        :messages="conversationStore.messages"
        :streaming-messages="streamingMessages"
        :is-direct-mode="isDirectMode"
      />
      <InterventionPanel />
      <ChatInput :swarm-id="swarmId" :active="conversationStore.isActive" :is-direct-mode="isDirectMode" />
    </div>
    <aside class="chat-sidebar-right">
      <AgentStatus :agents="Array.from(conversationStore.agentStates.values())" />
    </aside>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--color-border-subtle);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.conversation-id {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
}

.mode-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 9999px;
  border: 1px solid;
}

.mode-badge.direct {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border-color: rgba(34, 197, 94, 0.25);
}

.chat-sidebar-right {
  width: 280px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  padding: 20px;
  overflow-y: auto;
  flex-shrink: 0;
}
</style>
