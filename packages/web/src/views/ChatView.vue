<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSwarmStore } from "../stores/swarm.js";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "../composables/useWebSocket.js";
import { forkConversation } from "../api/conversations.js";
import MessageList from "../components/chat/MessageList.vue";
import ChatInput from "../components/chat/ChatInput.vue";
import AgentStatus from "../components/chat/AgentStatus.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";

const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const { connect, connected } = useWebSocket();
const route = useRoute();
const router = useRouter();
const draftSwarmId = ref<string>("");

const routeConversationId = computed(() => {
  const rawConversationId = route.params.conversationId;
  if (typeof rawConversationId !== "string") {
    return null;
  }
  const normalizedConversationId = rawConversationId.trim();
  return normalizedConversationId.length > 0 ? normalizedConversationId : null;
});
const draftMode = computed<"direct" | "swarm">(() =>
  route.query.mode === "swarm" ? "swarm" : "direct",
);
const currentConversation = computed(() =>
  routeConversationId.value
    ? conversationStore.conversations.find((c) => c.id === routeConversationId.value) ?? null
    : null,
);
const swarmId = computed(() => {
  const conv = currentConversation.value;
  if (conv && !conv.swarmId.startsWith("__direct_")) {
    return conv.swarmId;
  }
  return draftSwarmId.value;
});
const isDirectMode = computed(() => {
  const conv = currentConversation.value;
  if (conv) return conv.swarmId.startsWith("__direct_");
  return draftMode.value === "direct";
});
const streamingMessages = computed(() =>
  Array.from(conversationStore.getStreamingMessages(routeConversationId.value).values()),
);

const currentConversationTitle = computed(() => {
  if (!routeConversationId.value) return null;
  const conv = conversationStore.conversations.find(
    (c) => c.id === routeConversationId.value,
  );
  return conv?.title ?? null;
});
const active = computed(() => conversationStore.getIsActive(routeConversationId.value));
const messages = computed(() => conversationStore.getMessages(routeConversationId.value));
const agentStates = computed(() => Array.from(conversationStore.getAgentStates(routeConversationId.value).values()));

onMounted(() => {
  swarmStore.fetchSwarms();
  if (!connected.value) {
    connect();
  }
  window.addEventListener("agent-swarm:conversation-created", handleConversationCreated);
});

onUnmounted(() => {
  window.removeEventListener("agent-swarm:conversation-created", handleConversationCreated);
});

function handleConversationCreated(event: Event) {
  const detail = (event as CustomEvent<{ conversationId?: unknown }>).detail;
  const conversationId = typeof detail?.conversationId === "string" ? detail.conversationId : "";
  if (!conversationId) {
    return;
  }
  if (routeConversationId.value !== conversationId) {
    void router.replace({ name: "chat", params: { conversationId } });
  }
}

watch(draftMode, (mode) => {
  if (mode === "direct") {
    draftSwarmId.value = "";
  }
});

watch(
  () => swarmStore.swarms.map((swarm) => swarm.id),
  (ids) => {
    if (draftSwarmId.value && !ids.includes(draftSwarmId.value)) {
      draftSwarmId.value = "";
    }
  },
  { immediate: true },
);

watch(
  routeConversationId,
  (conversationId) => {
    if (!conversationId) {
      return;
    }

    void conversationStore.openConversation(conversationId).catch(() => {
      if (routeConversationId.value === conversationId) {
        void router.replace({ name: "chat", params: {} });
      }
    });
  },
  { immediate: true },
);

function handleNewConversation() {
  void router.push({ name: "chat", params: {}, query: { mode: "swarm" } });
}

function handleSelectDraftSwarm(swarmId: string) {
  draftSwarmId.value = swarmId;
  if (routeConversationId.value) {
    void router.push({ name: "chat", params: {}, query: { mode: "swarm" } });
  }
}

async function handleForkConversation() {
  const convId = routeConversationId.value;
  if (!convId) return;
  try {
    const res = await forkConversation(convId);
    const forked = res.data;
    if (!forked?.id) {
      throw new Error("分支会话创建失败");
    }
    const existingIndex = conversationStore.conversations.findIndex((item) => item.id === forked.id);
    if (existingIndex >= 0) {
      conversationStore.conversations[existingIndex] = forked;
    } else {
      conversationStore.conversations.unshift(forked);
    }
    void router.push(`/chat/${forked.id}`);
  } catch (err) {
    console.error("Fork failed:", err instanceof Error ? err.message : err);
  }
}
</script>

<template>
  <div class="chat-view">
    <div class="chat-main">
      <div class="chat-header">
        <div class="chat-header-left">
          <template v-if="currentConversationTitle">
            <h2>{{ currentConversationTitle }}</h2>
          </template>
          <template v-else>
            <h2>{{ isDirectMode ? '直接对话' : '对话' }}</h2>
          </template>
          <span v-if="isDirectMode" class="mode-badge direct">直接对话模式</span>
        </div>
        <button
          v-if="routeConversationId"
          class="new-chat-btn fork-btn"
          @click="handleForkConversation"
          title="创建分支对话"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <line x1="8.21" y1="13.89" x2="15" y2="9" />
            <line x1="8.21" y1="10.11" x2="15" y2="15" />
          </svg>
          分支
        </button>
        <button class="new-chat-btn" @click="handleNewConversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新对话
        </button>
      </div>
      <MessageList
        :messages="messages"
        :streaming-messages="streamingMessages"
        :is-direct-mode="isDirectMode"
        :conversation-id="routeConversationId"
        :swarm-id="swarmId"
        @select-swarm="handleSelectDraftSwarm"
      />
      <InterventionPanel />
      <ChatInput
        :key="routeConversationId ?? `new-${draftMode}`"
        :conversation-id="routeConversationId"
        :swarm-id="swarmId"
        :active="active"
        :is-direct-mode="isDirectMode"
      />
    </div>
    <aside class="chat-sidebar-right">
      <AgentStatus :agents="agentStates" :swarm-id="swarmId" />
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
  padding: 10px 24px;
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
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
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

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.new-chat-btn {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.new-chat-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.chat-sidebar-right {
  width: 260px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  padding: 20px;
  overflow-y: auto;
  flex-shrink: 0;
}

@media (max-width: 1024px) {
  .chat-sidebar-right {
    display: none;
  }
}
</style>
