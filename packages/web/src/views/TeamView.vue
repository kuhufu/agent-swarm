<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import * as conversationsApi from "../api/conversations.js";
import TeamTracePanel from "../components/chat/TeamTracePanel.vue";
import SvgIcon from "../components/common/SvgIcon.vue";
import { formatTimeLong } from "../utils/format.js";
import { showError } from "../utils/ui-feedback.js";
import type { ConversationEvent, ConversationInfo } from "../types/index.js";

const router = useRouter();
const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();

const selectedConversationId = ref<string | null>(null);
const loading = ref(false);
const loadingEvents = ref(false);
const teamEventCounts = ref<Map<string, number>>(new Map());
const teamEventsByConversation = ref<Map<string, ConversationEvent[]>>(new Map());

const teamConversations = computed(() =>
  conversationStore.conversations
    .filter((conversation) => getConversationMode(conversation) === "team")
    .sort((a, b) => b.updatedAt - a.updatedAt),
);

const selectedConversation = computed(() =>
  selectedConversationId.value
    ? teamConversations.value.find((conversation) => conversation.id === selectedConversationId.value) ?? null
    : null,
);

const selectedEvents = computed(() =>
  selectedConversationId.value
    ? teamEventsByConversation.value.get(selectedConversationId.value) ?? []
    : [],
);

const visibleTeamConversations = computed(() =>
  teamConversations.value.filter((conversation) => (teamEventCounts.value.get(conversation.id) ?? 0) > 0),
);

const totalRuns = computed(() => {
  let total = 0;
  for (const count of teamEventCounts.value.values()) {
    total += count;
  }
  return total;
});

const selectedEventCount = computed(() => selectedEvents.value.length);

onMounted(async () => {
  await loadTeamPage();
});

watch(visibleTeamConversations, (items) => {
  if (items.length === 0) {
    selectedConversationId.value = null;
    return;
  }
  if (!selectedConversationId.value || !items.some((conversation) => conversation.id === selectedConversationId.value)) {
    void selectConversation(items[0].id);
  }
});

async function loadTeamPage() {
  loading.value = true;
  try {
    await Promise.all([
      conversationStore.fetchAllConversations(),
      swarmStore.fetchSwarms(),
    ]);
    await loadTeamEventCounts();
  } catch (err) {
    showError(err instanceof Error ? err.message : "加载 Team 工作台失败");
  } finally {
    loading.value = false;
  }
}

async function loadTeamEventCounts() {
  const entries = await Promise.all(
    teamConversations.value.map(async (conversation) => {
      try {
        const res = await conversationsApi.getEvents(conversation.id, "team_run_start");
        return [conversation.id, Array.isArray(res.data) ? res.data.length : 0] as const;
      } catch {
        return [conversation.id, 0] as const;
      }
    }),
  );
  teamEventCounts.value = new Map(entries);
}

async function selectConversation(conversationId: string) {
  selectedConversationId.value = conversationId;
  if (teamEventsByConversation.value.has(conversationId)) {
    return;
  }
  loadingEvents.value = true;
  try {
    const res = await conversationsApi.getEvents(conversationId);
    const teamEvents = (Array.isArray(res.data) ? res.data : [])
      .filter((event) => event.eventType.startsWith("team_"));
    teamEventsByConversation.value = new Map(teamEventsByConversation.value).set(conversationId, teamEvents);
    teamEventCounts.value = new Map(teamEventCounts.value).set(
      conversationId,
      teamEvents.filter((event) => event.eventType === "team_run_start").length,
    );
  } catch (err) {
    showError(err instanceof Error ? err.message : "加载 Team 事件失败");
    teamEventsByConversation.value = new Map(teamEventsByConversation.value).set(conversationId, []);
  } finally {
    loadingEvents.value = false;
  }
}

function getConversationMode(conversation: ConversationInfo): string | null {
  if (conversation.swarmId.startsWith("__direct_")) return "chat";
  return swarmStore.swarms.find((swarm) => swarm.id === conversation.swarmId)?.mode ?? null;
}

function getSwarmName(conversation: ConversationInfo): string {
  if (conversation.swarmId.startsWith("__direct_")) return "直接对话";
  return swarmStore.swarms.find((swarm) => swarm.id === conversation.swarmId)?.name ?? conversation.swarmId;
}

function openChat() {
  if (!selectedConversationId.value) return;
  void router.push({ name: "chat", params: { conversationId: selectedConversationId.value } });
}
</script>

<template>
  <div class="team-page">
    <aside class="team-list-pane">
      <header class="team-page-header">
        <div>
          <h1>Team 工作台</h1>
          <p>需求分析、头脑风暴和落地规划的 Team Run 视图</p>
        </div>
        <button type="button" title="刷新" :disabled="loading" @click="loadTeamPage">
          <SvgIcon name="refresh" :size="14" />
        </button>
      </header>

      <section class="team-metrics">
        <div>
          <span>Team 会话</span>
          <strong>{{ visibleTeamConversations.length }}</strong>
        </div>
        <div>
          <span>已加载 Run</span>
          <strong>{{ totalRuns }}</strong>
        </div>
      </section>

      <div v-if="loading" class="team-empty">加载中...</div>
      <div v-else-if="visibleTeamConversations.length === 0" class="team-empty">暂无 Team 运行记录</div>
      <div v-else class="team-conversation-list">
        <button
          v-for="conversation in visibleTeamConversations"
          :key="conversation.id"
          type="button"
          class="team-conversation"
          :class="{ active: selectedConversationId === conversation.id }"
          @click="selectConversation(conversation.id)"
        >
          <span class="team-conversation-title">{{ conversation.title ?? "新对话" }}</span>
          <span class="team-conversation-meta">
            {{ getSwarmName(conversation) }} · {{ teamEventCounts.get(conversation.id) ?? 0 }} Run
          </span>
          <small>{{ formatTimeLong(conversation.updatedAt) }}</small>
        </button>
      </div>
    </aside>

    <main class="team-workbench-pane">
      <div v-if="!selectedConversation" class="team-placeholder">
        <SvgIcon name="swarm" :size="28" />
        <span>选择一个 Team 会话查看工作台</span>
      </div>
      <template v-else>
        <header class="workbench-header">
          <div>
            <h2>{{ selectedConversation.title ?? "新对话" }}</h2>
            <p>{{ getSwarmName(selectedConversation) }} · {{ selectedEventCount }} 条 Team 事件</p>
          </div>
          <button type="button" @click="openChat">
            <SvgIcon name="chat" :size="14" />
            打开对话
          </button>
        </header>
        <div class="workbench-shell">
          <div v-if="loadingEvents" class="team-placeholder">Team 事件加载中...</div>
          <TeamTracePanel v-else :events="selectedEvents" />
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.team-page {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  background: var(--bg-root);
}

.team-list-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.team-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.team-page-header h1,
.workbench-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.team-page-header p,
.workbench-header p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.team-page-header button,
.workbench-header button {
  flex: 0 0 auto;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.team-page-header button:hover,
.workbench-header button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.team-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.team-metrics div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.team-metrics span,
.team-metrics strong {
  display: block;
}

.team-metrics span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.team-metrics strong {
  margin-top: 4px;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.team-conversation-list {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.team-conversation {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 5px;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.team-conversation + .team-conversation {
  margin-top: 4px;
}

.team-conversation:hover,
.team-conversation.active {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
}

.team-conversation-title,
.team-conversation-meta,
.team-conversation small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-conversation-title {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.team-conversation-meta {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.team-conversation small,
.team-empty,
.team-placeholder {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.team-empty {
  padding: 18px;
}

.team-workbench-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.workbench-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.workbench-shell {
  flex: 1;
  min-height: 0;
  padding: 16px;
}

.workbench-shell :deep(.team-panel) {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.team-placeholder {
  height: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-surface);
}
</style>
