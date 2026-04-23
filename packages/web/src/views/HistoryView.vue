<script setup lang="ts">
import { onMounted, ref, computed, reactive } from "vue";
import { useRouter } from "vue-router";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import * as conversationsApi from "../api/conversations.js";
import { getModeConfig } from "../constants/swarm-modes.js";
import { formatTimeLong } from "../utils/format.js";
import ModeIcon from "../components/common/ModeIcon.vue";
import type { ConversationInfo, SwarmConfig, ChatMessage } from "../types/index.js";
import { confirmDialog, showError } from "../utils/ui-feedback.js";

const router = useRouter();
const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();
const searchQuery = ref("");
const selectedConvId = ref<string | null>(null);
const expandedMessages = reactive<Map<string, ChatMessage[]>>(new Map());
const loadingMessages = ref(false);

const filteredConversations = computed(() => {
  if (!searchQuery.value) return conversationStore.conversations;
  const q = searchQuery.value.toLowerCase();
  return conversationStore.conversations.filter(
    (c: ConversationInfo) => c.title?.toLowerCase().includes(q),
  );
});

const selectedConv = computed(() =>
  conversationStore.conversations.find((c: ConversationInfo) => c.id === selectedConvId.value) ?? null
);

const selectedMessages = computed(() =>
  selectedConvId.value ? expandedMessages.get(selectedConvId.value) ?? null : null
);

onMounted(async () => {
  await conversationStore.fetchAllConversations();
});

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
}

async function resumeConversation(conv: ConversationInfo) {
  const swarm = swarmStore.swarms.find((s: SwarmConfig) => s.id === conv.swarmId);
  if (swarm) {
    swarmStore.selectSwarm(swarm);
  }
  await conversationStore.openConversation(conv.id);
  await router.push("/chat");
}

async function deleteConversation(conv: ConversationInfo) {
  const confirmed = await confirmDialog({
    header: "删除会话",
    body: `确定要删除对话 "${conv.title ?? "新对话"}" 吗？`,
    confirmText: "删除",
    cancelText: "取消",
    theme: "danger",
  });
  if (!confirmed) {
    return;
  }

  try {
    await conversationStore.deleteConversation(conv.id);
    expandedMessages.delete(conv.id);
    if (selectedConvId.value === conv.id) {
      selectedConvId.value = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除失败";
    showError(message);
  }
}

const formatTime = formatTimeLong;

function getSwarmName(swarmId: string): string {
  return swarmStore.swarms.find((s: SwarmConfig) => s.id === swarmId)?.name ?? swarmId;
}

function getSwarmMode(swarmId: string): string {
  return swarmStore.swarms.find((s: SwarmConfig) => s.id === swarmId)?.mode ?? "router";
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
  if (!raw) {
    return null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
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
  if (!provider || !model) {
    return null;
  }
  return `${provider}/${model}`;
}

function getMessageLabel(message: ChatMessage, conversation: ConversationInfo): string {
  if (message.role !== "assistant") {
    return getRoleLabel(message.role);
  }

  const metadataModelLabel = messageMetadataModelLabel(message);
  const isDirectConversation = conversation.swarmId.startsWith("__direct_");
  if (isDirectConversation) {
    return metadataModelLabel ?? message.agentName ?? message.agentId ?? "助手";
  }
  return message.agentName ?? message.agentId ?? metadataModelLabel ?? "助手";
}
</script>

<template>
  <div class="history-view">
    <div class="history-layout">
      <!-- Left Sidebar -->
      <aside class="history-sidebar">
        <div class="sidebar-header">
          <h2>历史对话</h2>
          <p>查看和管理对话记录</p>
        </div>

        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="searchQuery"
            class="input-field search-input"
            placeholder="搜索对话..."
          />
        </div>

        <nav class="history-nav">
          <div class="nav-divider">对话列表</div>

          <button
            v-for="conv in filteredConversations"
            :key="conv.id"
            class="nav-item conv-nav-item"
            :class="{ active: selectedConvId === conv.id }"
            @click="selectConv(conv)"
          >
            <div class="conv-nav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <span class="nav-label">{{ conv.title ?? "新对话" }}</span>
              <span class="nav-desc">{{ getSwarmName(conv.swarmId) }} · {{ formatTime(conv.updatedAt) }}</span>
            </div>
          </button>

          <div v-if="!filteredConversations.length" class="nav-empty">
            {{ searchQuery ? "未找到匹配" : "暂无对话" }}
          </div>
        </nav>
      </aside>

      <!-- Right Content -->
      <main class="history-content">
        <!-- No selection -->
        <div v-if="!selectedConv" class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p class="empty-title">选择一个对话查看详情</p>
          <p class="empty-desc">点击左侧对话项查看消息记录</p>
        </div>

        <!-- Detail Panel -->
        <div v-else class="detail-panel">
          <div class="detail-header">
            <div class="detail-title-row">
              <div class="detail-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 22px; height: 22px;">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div class="detail-title-info">
                <h3 class="detail-title">{{ selectedConv.title ?? "新对话" }}</h3>
                <div class="detail-meta">
                  <span class="swarm-badge" :style="{ background: getModeConfig(getSwarmMode(selectedConv.swarmId)).color + '20', color: getModeConfig(getSwarmMode(selectedConv.swarmId)).color }">
                    <ModeIcon :mode="getSwarmMode(selectedConv.swarmId)" :size="12" />
                    {{ getSwarmName(selectedConv.swarmId) }}
                  </span>
                  <span class="meta-text">{{ formatTime(selectedConv.updatedAt) }}</span>
                  <span class="meta-text mono">{{ selectedConv.id.slice(0, 8) }}</span>
                </div>
              </div>
            </div>
            <div class="detail-actions">
              <button class="btn-primary" @click="resumeConversation(selectedConv)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                继续对话
              </button>
              <button class="btn-danger" @click="deleteConversation(selectedConv)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                删除
              </button>
            </div>
          </div>

          <!-- Messages -->
          <div class="detail-section">
            <h4 class="detail-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              消息记录
              <span v-if="selectedMessages" class="msg-count">{{ selectedMessages.length }} 条</span>
            </h4>

            <div v-if="selectedMessages && selectedMessages.length" class="detail-messages">
              <div
                v-for="msg in selectedMessages"
                :key="msg.id"
                class="detail-message card"
              >
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

/* Left Sidebar */
.history-sidebar {
  width: 280px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 24px 16px;
}

.sidebar-header {
  margin-bottom: 16px;
  padding: 0 8px;
}

.sidebar-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.sidebar-header p {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.search-box {
  position: relative;
  margin-bottom: 12px;
  padding: 0 4px;
}

.search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.search-input {
  padding-left: 40px;
}

.history-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.nav-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nav-label {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}

.nav-item.active .nav-desc {
  color: rgba(129, 140, 248, 0.7);
}

.nav-divider {
  padding: 12px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.conv-nav-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.nav-item.active .conv-nav-icon {
  color: var(--color-accent-light);
  background: rgba(99, 102, 241, 0.12);
}

.nav-empty {
  padding: 20px 8px;
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
}

/* Right Content */
.history-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 0;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 14px;
}

.empty-icon svg {
  width: 24px;
  height: 24px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: 13px;
  margin: 0;
}

/* Detail Panel */
.detail-panel {
  max-width: 720px;
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.detail-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  border: 1px solid var(--color-border-subtle);
  color: var(--color-accent-light);
  flex-shrink: 0;
}

.detail-title-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.swarm-badge {
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
}

.meta-text {
  font-size: 12px;
  color: var(--color-text-muted);
}

.meta-text.mono {
  font-family: var(--font-mono);
}

.detail-actions {
  display: flex;
  gap: 10px;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: rgba(99, 102, 241, 0.25);
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-danger:hover {
  background: rgba(248, 113, 113, 0.2);
}

/* Detail Section */
.detail-section {
  margin-bottom: 28px;
}

.detail-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 16px;
}

.msg-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 8px;
  border-radius: 9999px;
}

/* Messages */
.detail-loading,
.detail-empty {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
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
  font-size: 12px;
  font-weight: 600;
}

.msg-body {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Shared */
.input-field {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: all 0.2s;
  box-sizing: border-box;
}

.input-field:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.05);
}

.input-field::placeholder {
  color: var(--color-text-muted);
}

.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}
</style>
