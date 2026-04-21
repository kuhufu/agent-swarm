<script setup lang="ts">
import { onMounted } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import { useConversationStore } from "../stores/conversation.js";
import MessageList from "../components/chat/MessageList.vue";
import ChatInput from "../components/chat/ChatInput.vue";
import AgentStatus from "../components/chat/AgentStatus.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";

const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();

onMounted(() => {
  swarmStore.fetchSwarms();
});
</script>

<template>
  <div class="chat-view">
    <div class="chat-main">
      <MessageList
        :messages="conversationStore.messages"
        :streaming-message="conversationStore.streamingMessage"
      />
      <InterventionPanel v-if="conversationStore.currentConversationId" />
      <ChatInput :conversation-id="conversationStore.currentConversationId" />
    </div>
    <aside class="chat-sidebar-right">
      <AgentStatus :swarm="swarmStore.currentSwarm" />
    </aside>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  gap: 0;
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
}
</style>
