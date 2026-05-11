<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSwarmStore } from "../../stores/swarm.js";
import { useConversationStore } from "../../stores/conversation.js";
import { useAuthStore } from "../../stores/auth.js";
import { useWebSocket } from "../../composables/useWebSocket.js";
import { formatTimeLocale } from "../../utils/format.js";
import type { ConversationInfo } from "../../types/index.js";
import { showError } from "../../utils/ui-feedback.js";
import SvgIcon from "../common/SvgIcon.vue";
import PersonalSettingsModal from "./PersonalSettingsModal.vue";
import SystemSettingsModal from "./SystemSettingsModal.vue";

const route = useRoute();
const router = useRouter();
const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const authStore = useAuthStore();
const { disconnect } = useWebSocket();

const personalSettingsOpen = ref(false);
const systemSettingsOpen = ref(false);

const isChatRoute = computed(() => route.name === "chat");
const chatMode = ref<"direct" | "swarm">("direct");
watch(
  () => route.query.mode,
  (mode) => {
    if (mode === "swarm" || mode === "direct") {
      chatMode.value = mode;
    }
  },
  { immediate: true },
);
const routeConversationId = computed(() => {
  const rawConversationId = route.params.conversationId;
  if (typeof rawConversationId !== "string") {
    return null;
  }
  const normalizedConversationId = rawConversationId.trim();
  return normalizedConversationId.length > 0 ? normalizedConversationId : null;
});
watch(
  () => routeConversationId.value,
  (id) => {
    if (!id) return;
    const convs = conversationStore.conversations;
    const conv = convs.find((c) => c.id === id);
    if (conv) {
      chatMode.value = conv.swarmId.startsWith("__direct_") ? "direct" : "swarm";
    }
  },
);
const showAuthSection = computed(() => authStore.isAuthenticated);
const isConversationActive = (id: string) => isChatRoute.value && routeConversationId.value === id;
const openedMenuConversationId = ref<string | null>(null);
const menuPosition = ref<{ left: number; top: number } | null>(null);
const showUserMenu = ref(false);
const userMenuPosition = ref<{ left: number; top: number } | null>(null);

const recentConversations = computed(() =>
  [...conversationStore.conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30),
);

const directConversations = computed(() =>
  recentConversations.value.filter((c) => c.swarmId.startsWith("__direct_")),
);

const swarmConversations = computed(() =>
  recentConversations.value.filter((c) => !c.swarmId.startsWith("__direct_")),
);

interface ConversationDayGroup {
  key: string;
  label: string;
  items: ConversationInfo[];
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(timestamp: number): string {
  const targetDay = startOfDay(timestamp);
  const today = startOfDay(Date.now());
  const diffDays = Math.round((today - targetDay) / 86_400_000);

  if (diffDays === 0) {
    return "今天";
  }
  if (diffDays === 1) {
    return "昨天";
  }

  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const conversationGroups = computed<ConversationDayGroup[]>(() => {
  const conversations = chatMode.value === "direct" ? directConversations.value : swarmConversations.value;
  const groups = new Map<string, ConversationDayGroup>();
  for (const conversation of conversations) {
    const key = dateKey(conversation.updatedAt);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(conversation);
      continue;
    }
    groups.set(key, {
      key,
      label: dayLabel(conversation.updatedAt),
      items: [conversation],
    });
  }
  return Array.from(groups.values());
});

/**
 * Resolve display label for a conversation's swarm context.
 * - Direct mode conversations have swarmId prefixed with "__direct_"
 * - Regular conversations reference a real swarm
 */
function getConversationLabel(conv: ConversationInfo): string {
  if (conv.swarmId.startsWith("__direct_")) {
    return conv.directModel?.modelId || "直接对话";
  }
  const swarm = swarmStore.swarms.find((s) => s.id === conv.swarmId);
  return swarm?.name ?? conv.swarmId;
}

const openedMenuConversation = computed(() =>
  openedMenuConversationId.value
    ? recentConversations.value.find((conv) => conv.id === openedMenuConversationId.value) ?? null
    : null,
);

function navigateTo(path: string) {
  if (path === "/chat") {
    void router.push({ name: "chat", params: routeConversationId.value ? { conversationId: routeConversationId.value } : {} });
    return;
  }
  void router.push(path);
}

async function handleLogout() {
  closeUserMenu();
  await authStore.logout();
  disconnect();
  await router.replace("/login");
}

const formatTime = formatTimeLocale;

async function handleOpenConversation(conv: ConversationInfo) {
  closeConversationMenu();
  await router.push({ name: "chat", params: { conversationId: conv.id } });
}

async function handleNewConversation() {
  closeConversationMenu();
  void router.push({ name: "chat", params: {}, query: { mode: chatMode.value } });
}

function closeConversationMenu() {
  openedMenuConversationId.value = null;
  menuPosition.value = null;
}

function computeMenuPosition(anchor: Element): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 128;
  const menuHeight = 88;
  const gap = 6;
  const viewportPadding = 8;

  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - menuWidth - viewportPadding,
  );

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - menuHeight - gap);
  }

  return { left, top };
}

function toggleConversationMenu(event: MouseEvent, conversationId: string) {
  const target = event.currentTarget;
  if (!(target instanceof Element)) {
    return;
  }

  if (openedMenuConversationId.value === conversationId) {
    closeConversationMenu();
    return;
  }

  openedMenuConversationId.value = conversationId;
  menuPosition.value = computeMenuPosition(target);
}

async function handleDeleteConversation(conv: ConversationInfo) {
  closeConversationMenu();
  try {
    await conversationStore.deleteConversation(conv.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除失败";
    showError(message);
  }
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    closeConversationMenu();
    closeUserMenu();
    return;
  }
  if (target.closest(".conversation-more") || target.closest(".conversation-menu-floating")) {
    return;
  }
  if (target.closest(".auth-user-trigger") || target.closest(".user-menu-floating")) {
    return;
  }
  closeConversationMenu();
  closeUserMenu();
}

function closeUserMenu() {
  showUserMenu.value = false;
  userMenuPosition.value = null;
}

function toggleUserMenu(event: MouseEvent) {
  const target = event.currentTarget;
  if (!(target instanceof Element)) return;
  if (showUserMenu.value) {
    closeUserMenu();
    return;
  }
  showUserMenu.value = true;
  const rect = target.getBoundingClientRect();
  const menuWidth = 160;
  const menuHeight = 44;
  const gap = 6;
  const viewportPadding = 8;
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - menuWidth - viewportPadding,
  );
  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - menuHeight - gap);
  }
  userMenuPosition.value = { left, top };
}

function handleWindowChange() {
  if (openedMenuConversationId.value) {
    closeConversationMenu();
  }
  if (showUserMenu.value) {
    closeUserMenu();
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);
  // Fetch all conversations on mount
  conversationStore.fetchAllConversations().catch(() => {});
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleGlobalClick);
  window.removeEventListener("resize", handleWindowChange);
  window.removeEventListener("scroll", handleWindowChange, true);
});

</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-brand" @click="navigateTo('/chat')">
      <div class="brand-icon">
        <SvgIcon name="swarm" :size="16" />
      </div>
      <span class="brand-text">Agent Swarm</span>
    </div>

    <div class="sidebar-tabs">
      <button
        class="tab-btn"
        :class="{ active: chatMode === 'direct' }"
        @click="chatMode = 'direct'"
      >
        <SvgIcon name="chat" :size="14" />
        <span>Chat</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: chatMode === 'swarm' }"
        @click="chatMode = 'swarm'"
      >
        <SvgIcon name="swarm" :size="14" />
        <span>Swarm</span>
      </button>
    </div>

    <section class="sidebar-section">
      <div class="section-header">
        <button class="new-conv-btn" @click="handleNewConversation">
          <SvgIcon name="plus" :size="14" />
          <span>新建{{ chatMode === 'direct' ? 'Chat' : 'Swarm' }}对话</span>
        </button>
      </div>
      <div class="conversation-list">
        <template v-for="group in conversationGroups" :key="group.key">
          <div class="conversation-day-divider">{{ group.label }}</div>
          <div
            v-for="conv in group.items"
            :key="conv.id"
            class="conversation-item"
            :class="{
              active: isConversationActive(conv.id),
              'menu-open': openedMenuConversationId === conv.id,
            }"
            @click="handleOpenConversation(conv)"
          >
            <div class="conversation-main">
              <div class="conversation-title-row">
                <span class="conversation-title">{{ conv.title ?? "新对话" }}</span>
                <span class="mode-tag" :class="conv.swarmId.startsWith('__direct_') ? 'direct' : 'swarm'">{{ getConversationLabel(conv) }}</span>
              </div>
              <span class="conversation-time">{{ formatTime(conv.updatedAt) }}</span>
            </div>
            <button
              class="conversation-more"
              title="更多操作"
              @click.stop="toggleConversationMenu($event, conv.id)"
            >
              <SvgIcon name="moreHorizontal" :size="13" />
            </button>
          </div>
        </template>
        <div v-if="!conversationGroups.length" class="conversation-empty">暂无会话</div>
      </div>
    </section>

    <nav class="sidebar-bottom-nav">
      <button class="bottom-nav-item" @click="router.push('/documents')">
        <SvgIcon name="book" :size="14" />
        <span>文档</span>
      </button>
      <button class="bottom-nav-item" @click="router.push('/wiki')">
        <SvgIcon name="book" :size="14" />
        <span>Wiki</span>
      </button>
      <button class="bottom-nav-item" @click="router.push('/history')">
        <SvgIcon name="history" :size="14" />
        <span>全部历史</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <div v-if="showAuthSection" class="footer-row">
        <button class="auth-user-trigger" :class="{ active: showUserMenu }" @click="toggleUserMenu">
          <div class="auth-avatar">{{ authStore.user?.username?.charAt(0)?.toUpperCase() }}</div>
          <span class="auth-username">{{ authStore.user?.username }}</span>
          <SvgIcon name="chevronDown" class="auth-chevron" :class="{ expanded: showUserMenu }" :size="13" />
        </button>
        <button class="settings-btn" title="个人设置" @click="personalSettingsOpen = true">
          <SvgIcon name="user" :size="15" />
        </button>
        <button v-if="authStore.user?.role === 'admin'" class="settings-btn" title="系统设置" @click="systemSettingsOpen = true">
          <SvgIcon name="wrench" :size="15" />
        </button>
      </div>
    </div>
  </aside>

  <teleport to="body">
    <div
      v-if="showUserMenu && userMenuPosition"
      class="user-menu-floating"
      :style="{ left: `${userMenuPosition.left}px`, top: `${userMenuPosition.top}px` }"
      @click.stop
    >
      <button class="conversation-menu-item danger" @click="handleLogout">退出登录</button>
    </div>

    <div
      v-if="openedMenuConversation && menuPosition"
      class="conversation-menu-floating"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @click.stop
    >
      <button class="conversation-menu-item" @click="handleOpenConversation(openedMenuConversation)">
        继续对话
      </button>
      <button class="conversation-menu-item danger" @click="handleDeleteConversation(openedMenuConversation)">
        删除会话
      </button>
    </div>

    <!-- 个人设置弹窗 -->
    <PersonalSettingsModal :open="personalSettingsOpen" @close="personalSettingsOpen = false" />

    <!-- 系统设置弹窗 -->
    <SystemSettingsModal :open="systemSettingsOpen" @close="systemSettingsOpen = false" />
  </teleport>
</template>

<style scoped>
.sidebar {
  width: 350px;
  background: var(--bg-surface);
  backdrop-filter: blur(24px) saturate(1.4);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: background 0.3s ease;
}

/* ── Brand ── */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
  cursor: pointer;
  user-select: none;
}

.brand-icon {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent);
  border-radius: 9px;
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35), inset 0 1px 0 rgba(255,255,255,0.2);
  flex-shrink: 0;
}

.brand-icon svg {
  width: 16px;
  height: 16px;
}

.brand-text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
  background: linear-gradient(135deg, var(--color-accent-light) 0%, var(--color-accent-light) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Tabs ── */
.sidebar-tabs {
  padding: 8px 10px 0;
  display: flex;
  gap: 4px;
}

.tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 9px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
  background: transparent;
  letter-spacing: -0.01em;
}

.tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-btn.active {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-secondary);
  box-shadow: inset 0 -2px 0 var(--color-accent);
}

/* ── Conversation section ── */
.sidebar-section {
  flex: 1;
  min-height: 0;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  padding: 0 2px;
}

.new-conv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 0;
  border: 1px dashed var(--border-subtle);
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: -0.01em;
}

.new-conv-btn:hover {
  border-color: rgba(99, 102, 241, 0.35);
  color: var(--text-secondary);
  background: rgba(99, 102, 241, 0.06);
}

/* ── Bottom nav ── */
.sidebar-bottom-nav {
  padding: 8px 10px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.bottom-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: none;
  border-radius: 7px;
  color: var(--text-muted);
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  letter-spacing: -0.01em;
}

.bottom-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* ── Conversation list ── */
.conversation-list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.conversation-day-divider {
  position: sticky;
  top: 0;
  z-index: 1;
  margin-top: 6px;
  margin-bottom: 2px;
  padding: 3px 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--bg-surface);
  backdrop-filter: blur(8px);
  border-radius: 5px;
}

.conversation-item {
  position: relative;
  background: transparent;
  border-radius: 8px;
  padding: 7px 9px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  transition: all 0.18s;
  border: 1px solid transparent;
}

.conversation-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
}

.conversation-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.15);
}

.conversation-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.conversation-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.conversation-title {
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  letter-spacing: -0.01em;
}

.conversation-item.active .conversation-title {
  color: var(--text-secondary);
}

.mode-tag {
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.6;
  letter-spacing: 0.01em;
}

.mode-tag.direct {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.18);
}

.mode-tag.swarm {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-secondary);
  border: 1px solid rgba(99, 102, 241, 0.18);
}

.conversation-time {
  color: var(--text-muted);
  font-size: 10.5px;
}

.conversation-more {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: all 0.15s;
}

.conversation-item:hover .conversation-more,
.conversation-item.active .conversation-more,
.conversation-item.menu-open .conversation-more {
  opacity: 1;
  pointer-events: auto;
}

.conversation-more:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.conversation-more svg {
  width: 13px;
  height: 13px;
}

/* ── Floating menus ── */
.conversation-menu-floating,
.user-menu-floating {
  position: fixed;
  z-index: 3000;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 4px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(20px);
}

.conversation-menu-floating {
  min-width: 128px;
}

.user-menu-floating {
  min-width: 140px;
}

.conversation-menu-item {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  font-size: 12.5px;
  font-weight: 500;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: -0.01em;
}

.conversation-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.conversation-menu-item.danger {
  color: var(--color-danger);
}

.conversation-menu-item.danger:hover {
  background: rgba(239,68,68,0.1);
}

.conversation-empty {
  color: var(--text-muted);
  font-size: 12px;
  padding: 12px 8px;
  text-align: center;
}

/* ── Footer ── */
.sidebar-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.footer-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auth-user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  background: transparent;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.15s;
  color: var(--text-secondary);
}

.auth-user-trigger:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.auth-user-trigger.active {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.06);
}

.auth-avatar {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--color-accent);
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
}

.auth-username {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  letter-spacing: -0.01em;
}

.auth-chevron {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.4;
  transition: transform 0.15s;
}

.auth-chevron.expanded {
  transform: rotate(180deg);
  opacity: 0.7;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.settings-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-color: rgba(99, 102, 241, 0.3);
}

</style>
