<script setup lang="ts">
import { onMounted, ref, computed, reactive } from "vue";
import { useRouter } from "vue-router";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import * as conversationsApi from "../api/conversations.js";
import { apiClient } from "../api/client.js";
import { getModeConfig } from "../constants/swarm-modes.js";
import { formatTimeLong } from "../utils/format.js";
import ModeIcon from "../components/common/ModeIcon.vue";
import SidebarPanel from "../components/common/SidebarPanel.vue";
import EmptyState from "../components/common/EmptyState.vue";
import DetailHeader from "../components/common/DetailHeader.vue";
import TeamTracePanel from "../components/chat/TeamTracePanel.vue";
import type { ConversationInfo, SwarmConfig, ChatMessage, ConversationEvent } from "../types/index.js";
import { confirmDialog, showError } from "../utils/ui-feedback.js";
import SvgIcon from "../components/common/SvgIcon.vue";

const router = useRouter();
const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();
const searchQuery = ref("");
const selectedConvId = ref<string | null>(null);
const expandedMessages = reactive<Map<string, ChatMessage[]>>(new Map());
const expandedEvents = reactive<Map<string, ConversationEvent[]>>(new Map());
const expandedArtifacts = reactive<Map<string, WorkspaceArtifact[]>>(new Map());
const loadingMessages = ref(false);
const loadingEvents = ref(false);
const loadingArtifacts = ref(false);

interface WorkspaceArtifact {
  path: string;
  name: string;
  size: number;
  kind: string;
  final: boolean;
}

const filteredConversations = computed(() => {
  if (!searchQuery.value) return conversationStore.conversations;
  const q = searchQuery.value.toLowerCase();
  return conversationStore.conversations.filter(
    (c: ConversationInfo) => c.title?.toLowerCase().includes(q),
  );
});

const navItems = computed(() =>
  filteredConversations.value.map((c) => ({
    id: c.id,
    label: c.title ?? "新对话",
    description: `${getSwarmName(c.swarmId)} · ${formatTimeLong(c.updatedAt)}`,
    active: selectedConvId.value === c.id,
  })),
);

const selectedConv = computed(() =>
  conversationStore.conversations.find((c: ConversationInfo) => c.id === selectedConvId.value) ?? null
);

const selectedMessages = computed(() =>
  selectedConvId.value ? expandedMessages.get(selectedConvId.value) ?? null : null
);
const selectedTeamEvents = computed(() =>
  selectedConvId.value
    ? (expandedEvents.get(selectedConvId.value) ?? null)?.filter((event) => event.eventType.startsWith("team_")) ?? null
    : null
);
const selectedFinalArtifacts = computed(() =>
  selectedConvId.value ? expandedArtifacts.get(selectedConvId.value) ?? null : null
);

onMounted(async () => {
  await conversationStore.fetchAllConversations();
});

async function selectNav(id: string) {
  const conv = conversationStore.conversations.find((c: ConversationInfo) => c.id === id);
  if (!conv) return;
  await selectConv(conv);
}

async function selectConv(conv: ConversationInfo) {
  selectedConvId.value = conv.id;
  if (!expandedMessages.has(conv.id)) {
    loadingMessages.value = true;
    try {
      const res = await conversationsApi.getMessages(conv.id);
      expandedMessages.set(conv.id, res.data);
    } catch {
      expandedMessages.set(conv.id, []);
    } finally {
      loadingMessages.value = false;
    }
  }
  if (!expandedEvents.has(conv.id)) {
    loadingEvents.value = true;
    try {
      const res = await conversationsApi.getEvents(conv.id);
      expandedEvents.set(conv.id, res.data);
    } catch {
      expandedEvents.set(conv.id, []);
    } finally {
      loadingEvents.value = false;
    }
  }
  if (!expandedArtifacts.has(conv.id)) {
    loadingArtifacts.value = true;
    try {
      if (!conv.workspaceId) {
        expandedArtifacts.set(conv.id, []);
        return;
      }
      const res = await apiClient<{ data: WorkspaceArtifact[] }>(`/workspaces/${conv.workspaceId}/files`);
      expandedArtifacts.set(conv.id, (res.data ?? []).filter((item) => item.final));
    } catch {
      expandedArtifacts.set(conv.id, []);
    } finally {
      loadingArtifacts.value = false;
    }
  }
}

async function resumeConversation(conv: ConversationInfo) {
  await router.push({ name: "chat", params: { conversationId: conv.id } });
}

async function deleteConversation(conv: ConversationInfo) {
  const confirmed = await confirmDialog({
    header: "删除会话",
    body: `确定要删除对话 "${conv.title ?? "新对话"}" 吗？`,
    confirmText: "删除",
    cancelText: "取消",
    theme: "danger",
  });
  if (!confirmed) return;

  try {
    await conversationStore.deleteConversation(conv.id);
    expandedMessages.delete(conv.id);
    expandedEvents.delete(conv.id);
    expandedArtifacts.delete(conv.id);
    if (selectedConvId.value === conv.id) {
      selectedConvId.value = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除失败";
    showError(message);
  }
}

function getSwarmName(swarmId: string): string {
  if (swarmId.startsWith("__direct_")) {
    return "直接对话";
  }
  return swarmStore.swarms.find((s: SwarmConfig) => s.id === swarmId)?.name ?? swarmId;
}

function getSwarmMode(swarmId: string): string {
  if (swarmId.startsWith("__direct_")) {
    return "chat";
  }
  return swarmStore.swarms.find((s: SwarmConfig) => s.id === swarmId)?.mode ?? "swarm";
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    user: "用户",
    assistant: "助手",
    system: "系统",
    notification: "通知",
    tool_result: "工具结果",
  };
  return map[role] ?? role;
}

function getRoleColor(role: string): string {
  const map: Record<string, string> = {
    user: "#818cf8",
    assistant: "#34d399",
    system: "#9ca3af",
    notification: "#fbbf24",
    tool_result: "#60a5fa",
  };
  return map[role] ?? "#9ca3af";
}

function parseMessageMetadata(message: ChatMessage): Record<string, unknown> | null {
  const raw = (message as { metadata?: unknown }).metadata;
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function messageMetadataModelLabel(message: ChatMessage): string | null {
  const metadata = parseMessageMetadata(message);
  const provider = typeof metadata?.provider === "string" ? metadata.provider.trim() : "";
  const model = typeof metadata?.model === "string" ? metadata.model.trim() : "";
  if (!provider || !model) return null;
  return `${provider}/${model}`;
}

function isRefineFinalReport(message: ChatMessage): boolean {
  const metadata = parseMessageMetadata(message);
  const refine = metadata?.refine;
  return Boolean(
    refine
    && typeof refine === "object"
    && !Array.isArray(refine)
    && (refine as Record<string, unknown>).type === "final_report",
  );
}

function getMessageLabel(message: ChatMessage, conversation: ConversationInfo): string {
  if (message.role !== "assistant") return getRoleLabel(message.role);
  if (isRefineFinalReport(message)) return "最终报告";

  const metadataModelLabel = messageMetadataModelLabel(message);
  const isDirectConversation = conversation.swarmId.startsWith("__direct_");
  if (isDirectConversation) {
    return metadataModelLabel ?? message.agentName ?? message.agentId ?? "助手";
  }
  return message.agentName ?? message.agentId ?? metadataModelLabel ?? "助手";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function downloadArtifact(workspaceId: string | undefined, artifact: WorkspaceArtifact) {
  if (!workspaceId) return;
  try {
    const token = localStorage.getItem("token");
    const response = await fetch(
      `/api/workspaces/${workspaceId}/files/download?path=${encodeURIComponent(artifact.path)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err instanceof Error ? err.message : "下载产物失败");
  }
}
</script>

<template>
  <div class="history-view">
    <div class="history-layout">
      <!-- Left Sidebar -->
      <SidebarPanel
        title="历史对话"
        description="查看和管理对话记录"
        search-placeholder="搜索对话..."
        v-model:search-model-value="searchQuery"
        nav-divider="对话列表"
        :nav-items="navItems"
        nav-item-icon="chat"
        :sidebar-width="320"
        @select-nav="selectNav"
      />

      <!-- Right Content -->
      <main class="history-content">
        <!-- No selection -->
        <EmptyState
          v-if="!selectedConv"
          icon="chat"
          title="选择一个对话查看详情"
          description="点击左侧对话项查看消息记录"
        />

        <!-- Detail Panel -->
        <div v-else class="detail-panel">
          <DetailHeader icon="chat" :title="selectedConv.title ?? '新对话'">
            <template #meta>
              <span class="swarm-badge" :style="{ background: getModeConfig(getSwarmMode(selectedConv.swarmId)).color + '20', color: getModeConfig(getSwarmMode(selectedConv.swarmId)).color }">
                <ModeIcon :mode="getSwarmMode(selectedConv.swarmId)" :size="12" />
                {{ getSwarmName(selectedConv.swarmId) }}
              </span>
              <span class="meta-text">{{ formatTimeLong(selectedConv.updatedAt) }}</span>
              <span class="meta-text mono">{{ selectedConv.id.slice(0, 8) }}</span>
            </template>
            <template #actions>
              <button class="btn-primary" @click="resumeConversation(selectedConv)">
                <SvgIcon name="chat" :size="14" />
                继续对话
              </button>
              <button class="btn-danger" @click="deleteConversation(selectedConv)">
                <SvgIcon name="trash" :size="14" />
                删除
              </button>
            </template>
          </DetailHeader>

          <!-- Final Artifacts -->
          <div v-if="loadingArtifacts || (selectedFinalArtifacts && selectedFinalArtifacts.length)" class="detail-section final-artifacts-section">
            <h4 class="detail-section-title">
              <SvgIcon name="folder" :size="16" />
              最终产物
              <span v-if="selectedFinalArtifacts" class="msg-count">{{ selectedFinalArtifacts.length }} 个</span>
            </h4>
            <div v-if="loadingArtifacts" class="detail-empty">最终产物加载中...</div>
            <div v-else-if="selectedFinalArtifacts && selectedFinalArtifacts.length" class="final-artifacts">
              <article v-for="artifact in selectedFinalArtifacts" :key="artifact.path" class="final-artifact-card">
                <div>
                  <strong>{{ artifact.name }}</strong>
                  <span>{{ artifact.path }}</span>
                  <small>{{ artifact.kind }} · {{ formatSize(artifact.size) }}</small>
                </div>
                <button type="button" title="下载" @click="downloadArtifact(selectedConv.workspaceId, artifact)">
                  <SvgIcon name="download" :size="14" />
                </button>
              </article>
            </div>
          </div>

          <!-- Team Trace -->
          <div v-if="loadingEvents || (selectedTeamEvents && selectedTeamEvents.length)" class="detail-section team-trace-section">
            <h4 class="detail-section-title">
              <SvgIcon name="history" :size="16" />
              Team 工作台
              <span v-if="selectedTeamEvents" class="msg-count">{{ selectedTeamEvents.length }} 条</span>
            </h4>
            <div v-if="loadingEvents" class="detail-empty">Team 过程加载中...</div>
            <div v-else-if="selectedTeamEvents && selectedTeamEvents.length" class="history-team-workbench">
              <TeamTracePanel :events="selectedTeamEvents" :messages="selectedMessages ?? undefined" />
            </div>
          </div>

          <!-- Messages -->
          <div class="detail-section">
            <h4 class="detail-section-title">
              <SvgIcon name="chat" :size="16" />
              消息记录
              <span v-if="selectedMessages" class="msg-count">{{ selectedMessages.length }} 条</span>
            </h4>

            <div v-if="selectedMessages && selectedMessages.length" class="detail-messages">
              <div v-for="msg in selectedMessages" :key="msg.id" class="detail-message card">
                <div class="msg-header">
                  <span class="msg-role-badge" :style="{ background: getRoleColor(msg.role) + '20', color: getRoleColor(msg.role) }">
                    {{ getMessageLabel(msg, selectedConv) }}
                  </span>
                </div>
                <div class="msg-body">{{ msg.content }}</div>
              </div>
            </div>
            <div v-else class="detail-empty">暂无消息</div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  height: 100%;
  overflow: hidden;
}

.history-layout {
  display: flex;
  height: 100%;
}

/* Right Content */
.history-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Detail Panel */
.detail-panel {
  max-width: 720px;
}

/* Detail Section */
.detail-section {
  margin-bottom: 28px;
}

.detail-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
  margin: 0 0 16px;
}

.msg-count {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 2px 8px;
  border-radius: 9999px;
}

.final-artifacts-section {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.final-artifacts {
  display: grid;
  gap: 10px;
}

.final-artifact-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-success);
  border-radius: 10px;
  background: var(--bg-success);
}

.final-artifact-card div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.final-artifact-card strong {
  color: var(--text-primary);
  font-size: var(--text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-artifact-card span,
.final-artifact-card small {
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.final-artifact-card button {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-surface);
  cursor: pointer;
  flex: 0 0 auto;
}

.team-trace-section {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.history-team-workbench {
  height: min(620px, 70vh);
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}

/* Messages */
.detail-loading,
.detail-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-base);
  padding: 40px 0;
}

.detail-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-message {
  padding: 14px 18px;
}

.msg-header {
  margin-bottom: 8px;
}

.msg-role-badge {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.msg-body {
  font-size: var(--text-base);
  color: var(--text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: none;
  background: var(--color-accent);
  color: #fff;
  cursor: pointer;
  font-size: var(--text-base);
  box-sizing: border-box;
  transition: all 0.15s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid var(--border-danger);
  color: var(--color-danger);
  background: var(--bg-danger);
  cursor: pointer;
  font-size: var(--text-base);
  box-sizing: border-box;
  transition: all 0.15s;
}

.btn-danger:hover {
  opacity: 0.85;
}

/* Meta */
.swarm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.meta-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.meta-text.mono {
  font-family: var(--font-mono);
}
</style>
