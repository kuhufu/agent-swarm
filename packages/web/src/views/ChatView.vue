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
import ConversationTrace from "../components/chat/ConversationTrace.vue";
import WorkspaceArtifactsPanel from "../components/chat/WorkspaceArtifactsPanel.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";
import { showError } from "../utils/ui-feedback.js";
import SvgIcon from "../components/common/SvgIcon.vue";

const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const { connect, connected } = useWebSocket();
const route = useRoute();
const router = useRouter();
const draftSwarmId = ref<string>("");
const activeSidebarTab = ref<"agents" | "trace" | "artifacts">("agents");
const selectedArtifactPath = ref<string | null>(null);

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
const traceEvents = computed(() => conversationStore.getEvents(routeConversationId.value));
const artifactRefreshKey = computed(() => {
  const paths: string[] = [];
  for (const message of messages.value) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.name !== "workspace_write_file" || !toolCall.result || typeof toolCall.result !== "object" || Array.isArray(toolCall.result)) {
        continue;
      }
      const path = (toolCall.result as Record<string, unknown>).path;
      if (typeof path === "string" && path) {
        paths.push(`${toolCall.id}:${path}`);
      }
    }
  }
  return paths.join("|");
});

onMounted(() => {
  swarmStore.fetchSwarms();
  if (!connected.value) {
    connect();
  }
  window.addEventListener("agent-swarm:conversation-created", handleConversationCreated);
  window.addEventListener("agent-swarm:open-artifact", handleOpenArtifact);
});

onUnmounted(() => {
  window.removeEventListener("agent-swarm:conversation-created", handleConversationCreated);
  window.removeEventListener("agent-swarm:open-artifact", handleOpenArtifact);
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

function handleOpenArtifact(event: Event) {
  const detail = (event as CustomEvent<{ path?: unknown }>).detail;
  const path = typeof detail?.path === "string" ? detail.path : "";
  if (!path) return;
  selectedArtifactPath.value = path;
  activeSidebarTab.value = "artifacts";
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

async function handleForkConversation(messageId?: string) {
  const convId = routeConversationId.value;
  if (!convId) return;
  try {
    const res = await forkConversation(convId, messageId ? { messageId } : {});
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
    showError(err instanceof Error ? err.message : "分支会话创建失败");
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
        <div class="chat-header-spacer"></div>
        <button
          v-if="routeConversationId"
          class="new-chat-btn fork-btn"
          @click="() => handleForkConversation()"
          title="创建分支对话"
        >
          <SvgIcon name="fork" :size="14" />
          分支
        </button>
      </div>
      <MessageList
        :messages="messages"
        :streaming-messages="streamingMessages"
        :is-direct-mode="isDirectMode"
        :conversation-id="routeConversationId"
        :swarm-id="swarmId"
        @select-swarm="handleSelectDraftSwarm"
        @fork-message="handleForkConversation"
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
      <div class="sidebar-tabs">
        <button
          type="button"
          :class="{ active: activeSidebarTab === 'agents' }"
          title="Agent"
          @click="activeSidebarTab = 'agents'"
        >
          <SvgIcon name="swarm" :size="14" />
        </button>
        <button
          type="button"
          :class="{ active: activeSidebarTab === 'trace' }"
          title="Trace"
          @click="activeSidebarTab = 'trace'"
        >
          <SvgIcon name="pulse" :size="14" />
        </button>
        <button
          type="button"
          :class="{ active: activeSidebarTab === 'artifacts' }"
          title="产物"
          @click="activeSidebarTab = 'artifacts'"
        >
          <SvgIcon name="folder" :size="14" />
        </button>
      </div>
      <AgentStatus v-if="activeSidebarTab === 'agents'" :agents="agentStates" :swarm-id="swarmId" />
      <ConversationTrace v-else-if="activeSidebarTab === 'trace'" :events="traceEvents" />
      <WorkspaceArtifactsPanel
        v-else
        :conversation-id="routeConversationId"
        :selected-path="selectedArtifactPath"
        :refresh-key="artifactRefreshKey"
      />
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

.chat-header-spacer {
  flex: 1;
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
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}

.sidebar-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  flex: 0 0 auto;
}

.sidebar-tabs button {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.sidebar-tabs button.active {
  color: var(--color-accent-light);
  background: rgba(99, 102, 241, 0.16);
}

.chat-sidebar-right :deep(.agent-status) {
  height: auto;
  min-height: 0;
  flex: 0 0 auto;
}

@media (max-width: 1024px) {
  .chat-sidebar-right {
    display: none;
  }
}
</style>
