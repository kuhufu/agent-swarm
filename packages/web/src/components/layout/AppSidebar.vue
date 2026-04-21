<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSwarmStore } from "../../stores/swarm.js";
import { useConversationStore } from "../../stores/conversation.js";
import type { ConversationInfo } from "../../types/index.js";
import { confirmDialog, showError } from "../../utils/ui-feedback.js";

const route = useRoute();
const router = useRouter();
const swarmStore = useSwarmStore();
const conversationStore = useConversationStore();

const navItems = [
  { label: "对话", route: "/chat", icon: MessageIcon },
  { label: "Swarm", route: "/swarms", icon: SwarmIcon },
  { label: "设置", route: "/settings", icon: SettingsIcon },
];

const isActive = (path: string) => route.path === path;
const isConversationActive = (id: string) => route.path === "/chat" && conversationStore.currentConversationId === id;
const openedMenuConversationId = ref<string | null>(null);
const menuPosition = ref<{ left: number; top: number } | null>(null);

const recentConversations = computed(() =>
  [...conversationStore.conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10),
);
const openedMenuConversation = computed(() =>
  openedMenuConversationId.value
    ? recentConversations.value.find((conv) => conv.id === openedMenuConversationId.value) ?? null
    : null,
);

function navigateTo(path: string) {
  router.push(path);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function handleOpenConversation(conv: ConversationInfo) {
  closeConversationMenu();
  if (route.path !== "/chat") {
    await router.push("/chat");
  }
  await conversationStore.openConversation(conv.id);
}

function handleNewConversation() {
  closeConversationMenu();
  if (route.path !== "/chat") {
    router.push("/chat");
  }
  conversationStore.setCurrentConversation(null);
}

function closeConversationMenu() {
  openedMenuConversationId.value = null;
  menuPosition.value = null;
}

function computeMenuPosition(anchor: Element): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 136;
  const menuHeight = 88;
  const gap = 6;
  const viewportPadding = 8;

  const left = Math.min(
    Math.max(rect.right - menuWidth, viewportPadding),
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除失败";
    showError(message);
  }
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    closeConversationMenu();
    return;
  }
  if (target.closest(".conversation-more") || target.closest(".conversation-menu-floating")) {
    return;
  }
  closeConversationMenu();
}

function handleWindowChange() {
  if (openedMenuConversationId.value) {
    closeConversationMenu();
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleGlobalClick);
  window.removeEventListener("resize", handleWindowChange);
  window.removeEventListener("scroll", handleWindowChange, true);
});

watch(
  () => swarmStore.currentSwarm?.id,
  async (swarmId) => {
    if (!swarmId) {
      return;
    }
    try {
      await conversationStore.fetchConversations(swarmId);
    } catch {
      // ignore sidebar conversation list fetch failure
    }
  },
  { immediate: true },
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

function SettingsIcon() {
  return h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-icon" }, [
    h("circle", { cx: "12", cy: "12", r: "3" }),
    h("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" }),
  ]);
}

import { h } from "vue";
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-brand" @click="router.push('/chat')">
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
        <span>历史对话</span>
        <button class="new-conv-btn" @click="handleNewConversation">新建</button>
      </div>
      <div class="conversation-list">
        <div
          v-for="conv in recentConversations"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: isConversationActive(conv.id) }"
          @click="handleOpenConversation(conv)"
        >
          <div class="conversation-main">
            <span class="conversation-title">{{ conv.title ?? "新对话" }}</span>
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
        <div v-if="conversationStore.loading" class="conversation-empty">加载中...</div>
        <div v-else-if="!recentConversations.length" class="conversation-empty">暂无历史对话</div>
      </div>
    </section>

    <div class="sidebar-footer">
      <div v-if="swarmStore.currentSwarm" class="current-swarm">
        <span class="swarm-label">当前 Swarm</span>
        <span class="swarm-name">{{ swarmStore.currentSwarm.name }}</span>
      </div>
    </div>
  </aside>

  <teleport to="body">
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
  width: 240px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
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
  background: rgba(255, 255, 255, 0.05);
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
  gap: 4px;
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

.conversation-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.conversation-item.active {
  background: rgba(99, 102, 241, 0.12);
}

.conversation-title {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-item.active .conversation-title {
  color: var(--color-accent-light);
}

.conversation-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
}

.conversation-more:hover {
  background: rgba(255, 255, 255, 0.08);
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
  background: rgba(20, 24, 36, 0.96);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
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
  background: rgba(255, 255, 255, 0.06);
}

.conversation-menu-item.danger {
  color: #fca5a5;
}

.conversation-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.15);
}

.conversation-empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 10px;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

.current-swarm {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.12);
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
</style>
