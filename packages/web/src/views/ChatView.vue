<script setup lang="ts">
import { onMounted, computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useSwarmStore } from "../stores/swarm.js";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "../composables/useWebSocket.js";
import MessageList from "../components/chat/MessageList.vue";
import ChatInput from "../components/chat/ChatInput.vue";
import AgentStatus from "../components/chat/AgentStatus.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";
import type { ConversationInfo } from "../types/index.js";

const router = useRouter();
const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const { connect, connected } = useWebSocket();

const swarmId = computed(() => swarmStore.currentSwarm?.id ?? "");

onMounted(() => {
  swarmStore.fetchSwarms();
  if (!connected.value) {
    connect();
  }
});

function handleNewConversation() {
  conversationStore.setCurrentConversation(null);
}

function handleSelectConversation(conv: ConversationInfo) {
  conversationStore.setCurrentConversation(conv.id);
}

function handleResumeConversation(conv: ConversationInfo) {
  conversationStore.setCurrentConversation(conv.id);
  router.push("/chat");
}
</script>

<template>
  <div class="chat-view">
    <div class="chat-main">
      <MessageList
        :messages="conversationStore.messages"
        :streaming-message="conversationStore.streamingMessage"
      />
      <InterventionPanel />
      <ChatInput :swarm-id="swarmId" :active="conversationStore.isActive" />
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
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.chat-sidebar-right {
  width: 280px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  padding: 16px;
  overflow-y: auto;
}
</style>
