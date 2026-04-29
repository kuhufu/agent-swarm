<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSwarmStore } from "../../stores/swarm.js";
import { useConversationStore } from "../../stores/conversation.js";
import { useThemeStore } from "../../stores/theme.js";
import { useAuthStore } from "../../stores/auth.js";
import { useWebSocket } from "../../composables/useWebSocket.js";
import { formatTimeLocale } from "../../utils/format.js";
import type { ConversationInfo } from "../../types/index.js";
import { showError } from "../../utils/ui-feedback.js";

const route = useRoute();
const router = useRouter();
const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();
const themeStore = useThemeStore();
const currentThemeLabel = computed(() => {
  const labels: Record<string, string> = { auto: "自动", light: "浅色", dark: "深色" };
  return labels[themeStore.mode] ?? "自动";
});
const authStore = useAuthStore();
const { disconnect } = useWebSocket();

const navItems = computed(() => [
  { label: "对话", route: "/chat", icon: MessageIcon },
  { label: "Swarm", route: "/swarms", icon: SwarmIcon },
  { label: "Agents", route: "/agents", icon: AgentsIcon },
  { label: "知识库", route: "/documents", icon: KnowledgeIcon },
  ...(authStore.user?.role === "admin" ? [{ label: "设置", route: "/settings", icon: SettingsIcon }] : []),
]);

const isChatRoute = computed(() => route.name === "chat");
const showAuthSection = computed(() => authStore.isAuthenticated);
const routeConversationId = computed(() => {
  const rawConversationId = route.params.conversationId;
  if (typeof rawConversationId !== "string") {
    return null;
  }
  const normalizedConversationId = rawConversationId.trim();
  return normalizedConversationId.length > 0 ? normalizedConversationId : null;
});
const isActive = (path: string) => (path === "/chat" ? isChatRoute.value : route.path === path);
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
  const groups = new Map<string, ConversationDayGroup>();
  for (const conversation of recentConversations.value) {
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
function getConversationMode(conv: ConversationInfo): { type: "direct" | "swarm"; label: string } {
  if (conv.swarmId.startsWith("__direct_")) {
    const provider = conv.directModel?.provider?.trim() ?? "";
    const modelId = conv.directModel?.modelId?.trim() ?? "";
    return { type: "direct", label: modelId || provider || "直接对话" };
  }
  const swarm = swarmStore.swarms.find((s) => s.id === conv.swarmId);
  return { type: "swarm", label: swarm?.name ?? conv.swarmId };
}

const openedMenuConversation = computed(() =>
  openedMenuConversationId.value
    ? recentConversations.value.find((conv) => conv.id === openedMenuConversationId.value) ?? null
    : null,
);

function navigateTo(path: string) {
  if (path === "/chat") {
    const currentConversationId = conversationStore.currentConversationId;
    void router.push({
      name: "chat",
      params: currentConversationId ? { conversationId: currentConversationId } : {},
    });
    return;
  }
  void router.push(path);
}

async function handleLogout() {
  closeUserMenu();
  await authStore.logout();
  disconnect();
  conversationStore.setCurrentConversation(null);
  swarmStore.clearSwarmSelection();
  await router.replace("/login");
}

const formatTime = formatTimeLocale;

async function handleOpenConversation(conv: ConversationInfo) {
  closeConversationMenu();
  await router.push({ name: "chat", params: { conversationId: conv.id } });
}

async function handleNewConversation() {
  closeConversationMenu();
  if (swarmStore.swarms.length === 0) {
    try {
      await swarmStore.fetchSwarms();
    } catch {
      // ignore fetch failure and surface user-friendly message below
    }
  }

  const targetSwarm = swarmStore.currentSwarm ?? swarmStore.swarms[0] ?? null;
  if (!targetSwarm) {
    showError("暂无可用 Swarm，请先创建");
    return;
  }

  if (!swarmStore.currentSwarm || swarmStore.currentSwarm.id !== targetSwarm.id) {
    swarmStore.selectSwarm(targetSwarm);
  }

  if (!isChatRoute.value || routeConversationId.value) {
    await router.push({ name: "chat", params: {} });
  }
  conversationStore.setCurrentConversation(null);
}

function handleNewDirectConversation() {
  closeConversationMenu();
  swarmStore.clearSwarmSelection();
  if (!isChatRoute.value || routeConversationId.value) {
    void router.push({ name: "chat", params: {} });
  }
  conversationStore.setCurrentConversation(null);
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

// Refresh conversation list when navigating to chat or when swarm changes
watch(
  () => swarmStore.currentSwarm?.id,
  async () => {
    try {
      await conversationStore.fetchAllConversations();
    } catch {
      // ignore sidebar conversation list fetch failure
    }
  },
);
</script>

<script lang="ts">
function MessageIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }),
  ]);
}

function SwarmIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("path", { d: "M12 2L2 7l10 5 10-5-10-5z" }),
    h("path", { d: "M2 17l10 5 10-5" }),
    h("path", { d: "M2 12l10 5 10-5" }),
  ]);
}

function AgentsIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("path", { d: "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }),
    h("circle", { cx: "8.5", cy: "7", r: "4" }),
    h("path", { d: "M23 21v-2a4 4 0 0 0-3-3.87" }),
    h("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }),
  ]);
}

function SettingsIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("circle", { cx: "12", cy: "12", r: "3" }),
    h("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" }),
  ]);
}

function KnowledgeIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }),
    h("path", { d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" }),
    h("line", { x1: "8", y1: "7", x2: "16", y2: "7" }),
    h("line", { x1: "8", y1: "11", x2: "14", y2: "11" }),
  ]);
}

import { h } from "vue";
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-brand" @click="navigateTo('/chat')">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <span class="brand-text">Agent Swarm</span>
    </div>

    <nav class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.route"
        class="nav-item"
        :class="{ active: isActive(item.route) }"
        @click="navigateTo(item.route)"
      >
        <component :is="item.icon" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <section class="sidebar-section">
      <div class="section-header">
        <span>会话</span>
        <div class="section-actions">
          <button class="action-btn direct" title="直接对话" @click="handleNewDirectConversation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            直接对话
          </button>
          <button class="action-btn new" title="新 Swarm 对话" @click="handleNewConversation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建
          </button>
        </div>
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
                <span
                  class="mode-tag"
                  :class="getConversationMode(conv).type"
                >{{ getConversationMode(conv).label }}</span>
              </div>
              <span class="conversation-time">{{ formatTime(conv.updatedAt) }}</span>
            </div>
            <button
              class="conversation-more"
              title="更多操作"
              @click.stop="toggleConversationMenu($event, conv.id)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </div>
        </template>
        <div v-if="!recentConversations.length" class="conversation-empty">暂无会话</div>
      </div>
    </section>

    <div class="sidebar-footer">
      <div v-if="showAuthSection" class="footer-row">
        <button class="auth-user-trigger" :class="{ active: showUserMenu }" @click="toggleUserMenu">
          <div class="auth-avatar">{{ authStore.user?.username?.charAt(0)?.toUpperCase() }}</div>
          <span class="auth-username">{{ authStore.user?.username }}</span>
          <svg class="auth-chevron" :class="{ expanded: showUserMenu }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button class="theme-toggle" @click="themeStore.cycleMode()" :title="currentThemeLabel">
        <svg v-if="themeStore.mode === 'auto'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a10 10 0 0 0 0 20z" />
        </svg>
        <svg v-else-if="themeStore.mode === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span class="theme-label">{{ currentThemeLabel }}</span>
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
  </teleport>
</template>

<style scoped>
.sidebar {
  width: 260px;
  background: var(--sidebar-bg);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: background 0.3s ease;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 20px 16px;
  cursor: pointer;
  user-select: none;
}

.brand-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-accent), #8b5cf6);
  border-radius: 10px;
  color: white;
}

.brand-icon svg {
  width: 18px;
  height: 18px;
}

.brand-text {
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--color-accent-light), #c084fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-nav {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--glass-hover-bg);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.sidebar-section {
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 4px;
}

.section-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 6px;
  transition: all 0.15s;
}

.action-btn.direct {
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.25);
  background: rgba(34, 197, 94, 0.08);
}

.action-btn.direct:hover {
  background: rgba(34, 197, 94, 0.15);
}

.action-btn.new {
  color: var(--color-accent-light);
}

.action-btn.new:hover {
  background: rgba(99, 102, 241, 0.1);
}

.new-conv-btn {
  border: none;
  background: transparent;
  color: var(--color-accent-light);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.conversation-list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conversation-item {
  position: relative;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: all 0.2s;
}

.conversation-day-divider {
  position: sticky;
  top: 0;
  z-index: 1;
  margin-top: 8px;
  margin-bottom: 4px;
  padding: 4px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--sidebar-bg);
  backdrop-filter: blur(6px);
  border-radius: 6px;
}

.conversation-item:hover {
  background: var(--glass-hover-bg);
}

.conversation-item.active {
  background: rgba(99, 102, 241, 0.12);
}

.conversation-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.conversation-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.conversation-title {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.conversation-item.active .conversation-title {
  color: var(--color-accent-light);
}

.mode-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
}

.mode-tag.direct {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.mode-tag.swarm {
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.conversation-time {
  color: var(--color-text-muted);
  font-size: 11px;
}

.conversation-more {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
}

.conversation-item:hover .conversation-more,
.conversation-item.active .conversation-more,
.conversation-item.menu-open .conversation-more {
  opacity: 1;
  pointer-events: auto;
}

.conversation-more:hover {
  background: var(--glass-hover-bg);
  color: var(--color-text-secondary);
}

.conversation-more svg {
  width: 14px;
  height: 14px;
}

.conversation-menu-floating {
  position: fixed;
  z-index: 3000;
  min-width: 128px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 4px;
  box-shadow: var(--shadow-menu);
  backdrop-filter: blur(12px);
}

.conversation-menu-item {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  font-size: 12px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.conversation-menu-item:hover {
  background: var(--glass-hover-bg);
}

.conversation-menu-item.danger {
  color: var(--color-danger);
}

.conversation-menu-item.danger:hover {
  background: var(--badge-danger-bg);
}

.conversation-empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 10px;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
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
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: border-color 0.15s;
  color: var(--color-text-secondary);
}

.auth-user-trigger:hover {
  border-color: var(--color-border-hover);
}

.auth-user-trigger.active {
  border-color: var(--color-border-hover);
  background: var(--glass-hover-bg);
}

.auth-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--color-accent), #8b5cf6);
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
}

.auth-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: transform 0.15s;
}

.auth-chevron.expanded {
  transform: rotate(180deg);
}

.user-menu-floating {
  position: fixed;
  z-index: 3000;
  min-width: 140px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 4px;
  box-shadow: var(--shadow-menu);
  backdrop-filter: blur(12px);
}

.theme-toggle {
  flex-shrink: 0;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--btn-secondary-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.theme-toggle:hover {
  background: var(--btn-secondary-hover-bg);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.theme-toggle svg {
  width: 15px;
  height: 15px;
}

.theme-label {
  font-size: 12px;
  line-height: 1;
}

.current-swarm {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.12);
  cursor: pointer;
  transition: all 0.15s;
  overflow: hidden;
  min-width: 0;
}

.current-swarm:hover {
  background: rgba(99, 102, 241, 0.12);
}

.current-swarm.direct {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.12);
}

.current-swarm.direct:hover {
  background: rgba(34, 197, 94, 0.12);
}

.swarm-label {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.swarm-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-accent-light);
}

.swarm-name.direct-name {
  color: #4ade80;
}
</style>
