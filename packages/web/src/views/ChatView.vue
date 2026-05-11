<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSwarmStore } from "../stores/swarm.js";
import { useConversationStore } from "../stores/conversation.js";
import { useWebSocket } from "../composables/useWebSocket.js";
import { forkConversation } from "../api/conversations.js";
import { createWorkspace, listWorkspaces } from "../api/workspaces.js";
import MessageList from "../components/chat/MessageList.vue";
import ChatInput from "../components/chat/ChatInput.vue";
import AgentStatus from "../components/chat/AgentStatus.vue";
import ConversationTrace from "../components/chat/ConversationTrace.vue";
import WorkspaceArtifactsPanel from "../components/chat/WorkspaceArtifactsPanel.vue";
import InterventionPanel from "../components/intervention/InterventionPanel.vue";
import { showError } from "../utils/ui-feedback.js";
import SvgIcon from "../components/common/SvgIcon.vue";
import type { WorkspaceInfo } from "../types/index.js";

const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const { connect, connected } = useWebSocket();
const route = useRoute();
const router = useRouter();
const draftSwarmId = ref<string>("");
const draftWorkspaceId = ref<string | null>(null);
const activeSidebarTab = ref<"agents" | "trace" | "artifacts">("agents");
const selectedArtifactPath = ref<string | null>(null);
const workspaces = ref<WorkspaceInfo[]>([]);
const workspacesLoading = ref(false);
const workspaceMenuOpen = ref(false);
const newWorkspaceName = ref("");

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
const currentWorkspaceId = computed(() => currentConversation.value?.workspaceId ?? draftWorkspaceId.value ?? null);
const currentWorkspace = computed(() =>
  currentWorkspaceId.value
    ? workspaces.value.find((workspace) => workspace.id === currentWorkspaceId.value) ?? null
    : null,
);
const workspaceLabel = computed(() => currentWorkspace.value?.name ?? (currentWorkspaceId.value ? "已选择工作区" : "未选择工作区"));

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
      if (toolCall.name !== "workspace_write_file" || !toolCall.details || typeof toolCall.details !== "object" || Array.isArray(toolCall.details)) {
        continue;
      }
      const path = (toolCall.details as Record<string, unknown>).path;
      if (typeof path === "string" && path) {
        paths.push(`${toolCall.id}:${path}`);
      }
    }
  }
  return paths.join("|");
});

onMounted(() => {
  swarmStore.fetchSwarms();
  void loadWorkspaces();
  if (!connected.value) {
    connect();
  }
  document.addEventListener("mousedown", handleDocumentMouseDown);
  window.addEventListener("agent-swarm:conversation-created", handleConversationCreated);
  window.addEventListener("agent-swarm:open-artifact", handleOpenArtifact);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleDocumentMouseDown);
  window.removeEventListener("agent-swarm:conversation-created", handleConversationCreated);
  window.removeEventListener("agent-swarm:open-artifact", handleOpenArtifact);
});

function handleDocumentMouseDown(event: MouseEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".workspace-selector")) {
    return;
  }
  workspaceMenuOpen.value = false;
}

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

async function loadWorkspaces() {
  workspacesLoading.value = true;
  try {
    const res = await listWorkspaces();
    workspaces.value = res.data ?? [];
    if (draftWorkspaceId.value && !workspaces.value.some((workspace) => workspace.id === draftWorkspaceId.value)) {
      draftWorkspaceId.value = null;
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : "加载工作区失败");
  } finally {
    workspacesLoading.value = false;
  }
}

async function selectWorkspace(workspaceId: string | null) {
  try {
    if (routeConversationId.value) {
      await conversationStore.updateConversationWorkspace(routeConversationId.value, workspaceId);
    } else {
      draftWorkspaceId.value = workspaceId;
    }
    selectedArtifactPath.value = null;
    workspaceMenuOpen.value = false;
  } catch (err) {
    showError(err instanceof Error ? err.message : "切换工作区失败");
  }
}

async function handleCreateWorkspace() {
  const name = newWorkspaceName.value.trim();
  if (!name) return;
  try {
    const res = await createWorkspace({ name });
    workspaces.value = [res.data, ...workspaces.value.filter((workspace) => workspace.id !== res.data.id)];
    newWorkspaceName.value = "";
    await selectWorkspace(res.data.id);
  } catch (err) {
    showError(err instanceof Error ? err.message : "创建工作区失败");
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
        <div class="chat-header-right">
          <div class="workspace-selector">
            <button
              class="workspace-select-btn"
              :class="{ selected: Boolean(currentWorkspaceId) }"
              type="button"
              :disabled="active"
              title="选择工作区"
              @click.stop="workspaceMenuOpen = !workspaceMenuOpen"
            >
              <SvgIcon name="folder" :size="14" />
              <span>{{ workspaceLabel }}</span>
              <SvgIcon name="chevronDown" :size="12" />
            </button>
            <div v-if="workspaceMenuOpen" class="workspace-menu" @click.stop>
              <div class="workspace-menu-header">
                <span>工作区</span>
                <button type="button" title="刷新" :disabled="workspacesLoading" @click="loadWorkspaces">
                  <SvgIcon name="refresh" :size="13" />
                </button>
              </div>
              <button
                class="workspace-menu-item"
                :class="{ active: !currentWorkspaceId }"
                type="button"
                @click="selectWorkspace(null)"
              >
                <span class="workspace-menu-name">不使用工作区</span>
                <span class="workspace-menu-meta">workspace 工具不可用</span>
              </button>
              <div class="workspace-menu-list">
                <button
                  v-for="workspace in workspaces"
                  :key="workspace.id"
                  class="workspace-menu-item"
                  :class="{ active: currentWorkspaceId === workspace.id }"
                  type="button"
                  @click="selectWorkspace(workspace.id)"
                >
                  <span class="workspace-menu-name">{{ workspace.name }}</span>
                  <span class="workspace-menu-meta">{{ workspace.description || workspace.id }}</span>
                </button>
                <div v-if="!workspacesLoading && workspaces.length === 0" class="workspace-empty">暂无工作区</div>
                <div v-if="workspacesLoading" class="workspace-empty">加载中...</div>
              </div>
              <form class="workspace-create" @submit.prevent="handleCreateWorkspace">
                <input
                  v-model="newWorkspaceName"
                  type="text"
                  maxlength="60"
                  placeholder="新工作区名称"
                >
                <button type="submit" :disabled="!newWorkspaceName.trim()">创建</button>
              </form>
            </div>
          </div>
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
        :workspace-id="currentWorkspaceId"
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
        :workspace-id="currentWorkspaceId"
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
  border-right: 1px solid var(--border-subtle);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-subtle);
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
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  margin: 0;
}

.mode-badge {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
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
  gap: 10px;
}

.workspace-selector {
  position: relative;
}

.workspace-select-btn {
  height: 32px;
  min-width: 150px;
  max-width: 240px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.workspace-select-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

  .workspace-select-btn:hover:not(:disabled),
  .workspace-select-btn.selected {
    color: var(--color-accent-light);
    border-color: var(--color-accent);
    background: var(--color-accent-bg);
  }

.workspace-select-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.workspace-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: 300px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.workspace-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.workspace-menu-header button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.workspace-menu-header button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.workspace-menu-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workspace-menu-item {
  width: 100%;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 8px 10px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.workspace-menu-item:hover,
.workspace-menu-item.active {
  background: var(--color-accent-bg);
  border-color: var(--color-accent);
  color: var(--color-accent-light);
}

.workspace-menu-name,
.workspace-menu-meta {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-menu-name {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.workspace-menu-meta {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.workspace-empty {
  padding: 18px 10px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.workspace-create {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.workspace-create input {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  outline: none;
}

.workspace-create input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-glow);
}

  .workspace-create button {
    height: 32px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-sm);
    padding: 0 12px;
    background: var(--color-accent-bg);
    color: var(--color-accent-light);
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    cursor: pointer;
  }

.workspace-create button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.new-chat-btn {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.new-chat-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--border-default);
  color: var(--text-primary);
}

.chat-sidebar-right {
  width: 380px;
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
  border: 1px solid var(--border-subtle);
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
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.sidebar-tabs button.active {
  color: var(--color-accent-light);
  background: var(--color-accent-bg);
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
