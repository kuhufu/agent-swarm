<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConversationStore } from "../stores/conversation.js";
import { useSwarmStore } from "../stores/swarm.js";
import { useChat } from "../composables/useChat.js";
import { useWebSocket } from "../composables/useWebSocket.js";
import * as conversationsApi from "../api/conversations.js";
import TeamTracePanel from "../components/chat/TeamTracePanel.vue";
import SvgIcon from "../components/common/SvgIcon.vue";
import { formatTimeLong } from "../utils/format.js";
import { showError } from "../utils/ui-feedback.js";
import type { ChatMessage, ConversationEvent, ConversationInfo } from "../types/index.js";

const router = useRouter();
const route = useRoute();
const conversationStore = useConversationStore();
const swarmStore = useSwarmStore();
const { connect } = useWebSocket();

const selectedConversationId = ref<string | null>(null);
const launchConversationId = ref<string | null>(null);
const selectedTeamSwarmId = ref("");
const launchTarget = ref<"new" | "current">("new");
const teamPrompt = ref("");
const conversationSearch = ref("");
const pendingNewConversation = ref(false);
const loading = ref(false);
const loadingEvents = ref(false);
const teamEventCounts = ref<Map<string, number>>(new Map());
const teamEventsByConversation = ref<Map<string, ConversationEvent[]>>(new Map());
const teamMessagesByConversation = ref<Map<string, ChatMessage[]>>(new Map());
const {
  inputText,
  sending,
  connected,
  sendMessage,
  abort,
} = useChat(launchConversationId, ref(null));

const routeConversationId = computed(() => {
  const rawConversationId = route.params.conversationId;
  if (typeof rawConversationId !== "string") {
    return null;
  }
  const normalized = rawConversationId.trim();
  return normalized.length > 0 ? normalized : null;
});

const teamConversations = computed(() =>
  conversationStore.conversations
    .filter((conversation) => getConversationMode(conversation) === "team")
    .sort((a, b) => b.updatedAt - a.updatedAt),
);

const teamSwarms = computed(() =>
  swarmStore.swarms
    .filter((swarm) => swarm.mode === "team")
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const selectedConversation = computed(() =>
  selectedConversationId.value
    ? teamConversations.value.find((conversation) => conversation.id === selectedConversationId.value) ?? null
    : null,
);

const selectedEvents = computed(() => {
  const conversationId = selectedConversationId.value;
  if (!conversationId) return [];
  const cachedEvents = teamEventsByConversation.value.get(conversationId) ?? [];
  const liveEvents = conversationStore.getTeamEvents(conversationId);
  if (liveEvents.length === 0) return cachedEvents;
  if (cachedEvents.length === 0) return liveEvents;
  return [...cachedEvents, ...liveEvents]
    .filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index)
    .sort((a, b) => a.timestamp - b.timestamp);
});
const selectedMessages = computed(() => {
  const conversationId = selectedConversationId.value;
  if (!conversationId) return [];
  return teamMessagesByConversation.value.get(conversationId) ?? [];
});

const visibleTeamConversations = computed(() =>
  teamConversations.value.filter((conversation) =>
    getConversationRunCount(conversation.id) > 0 || conversation.id === selectedConversationId.value,
  ),
);

const filteredTeamConversations = computed(() => {
  const keyword = conversationSearch.value.trim().toLowerCase();
  if (!keyword) return visibleTeamConversations.value;
  return visibleTeamConversations.value.filter((conversation) => {
    const title = (conversation.title ?? "新对话").toLowerCase();
    const swarmName = getSwarmName(conversation).toLowerCase();
    return title.includes(keyword) || swarmName.includes(keyword) || conversation.id.toLowerCase().includes(keyword);
  });
});

const totalRuns = computed(() => {
  let total = 0;
  for (const conversation of teamConversations.value) {
    total += getConversationRunCount(conversation.id);
  }
  return total;
});

const selectedEventCount = computed(() => selectedEvents.value.length);
const selectedConversationActive = computed(() =>
  selectedConversationId.value ? conversationStore.getIsActive(selectedConversationId.value) : false,
);
const canSendPrompt = computed(() =>
  teamPrompt.value.trim().length > 0
  && Boolean(selectedTeamSwarmId.value)
  && connected.value
  && !sending.value
  && !(launchTarget.value === "current" && selectedConversationActive.value),
);

onMounted(async () => {
  connect();
  window.addEventListener("agent-swarm:conversation-created", handleConversationCreated);
  await loadTeamPage();
});

onUnmounted(() => {
  window.removeEventListener("agent-swarm:conversation-created", handleConversationCreated);
});

watch(visibleTeamConversations, (items) => {
  if (routeConversationId.value) {
    if (selectedConversationId.value !== routeConversationId.value) {
      void selectConversation(routeConversationId.value, false);
    }
    return;
  }
  if (items.length === 0) {
    selectedConversationId.value = null;
    return;
  }
  if (!selectedConversationId.value || !items.some((conversation) => conversation.id === selectedConversationId.value)) {
    void selectConversation(items[0].id);
  }
});

watch(teamSwarms, (items) => {
  if (!selectedTeamSwarmId.value || !items.some((swarm) => swarm.id === selectedTeamSwarmId.value)) {
    selectedTeamSwarmId.value = items[0]?.id ?? "";
  }
}, { immediate: true });

watch(selectedConversationId, (conversationId) => {
  if (launchTarget.value === "current") {
    launchConversationId.value = conversationId;
  }
});

watch(routeConversationId, (conversationId) => {
  if (!conversationId) return;
  if (selectedConversationId.value !== conversationId) {
    void selectConversation(conversationId, false);
  }
}, { immediate: true });

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

async function selectConversation(conversationId: string, syncRoute = true) {
  selectedConversationId.value = conversationId;
  if (syncRoute && routeConversationId.value !== conversationId) {
    void router.replace({ name: "team", params: { conversationId } });
  }
  if (launchTarget.value === "current") {
    launchConversationId.value = conversationId;
  }
  if (teamEventsByConversation.value.has(conversationId) && teamMessagesByConversation.value.has(conversationId)) {
    return;
  }
  loadingEvents.value = true;
  try {
    const [eventsRes, messagesRes] = await Promise.all([
      conversationsApi.getEvents(conversationId),
      conversationsApi.getMessages(conversationId),
    ]);
    const teamEvents = (Array.isArray(eventsRes.data) ? eventsRes.data : [])
      .filter((event) => event.eventType.startsWith("team_"));
    teamEventsByConversation.value = new Map(teamEventsByConversation.value).set(conversationId, teamEvents);
    teamMessagesByConversation.value = new Map(teamMessagesByConversation.value).set(
      conversationId,
      Array.isArray(messagesRes.data) ? messagesRes.data : [],
    );
    teamEventCounts.value = new Map(teamEventCounts.value).set(
      conversationId,
      teamEvents.filter((event) => event.eventType === "team_run_start").length,
    );
  } catch (err) {
    showError(err instanceof Error ? err.message : "加载 Team 事件失败");
    teamEventsByConversation.value = new Map(teamEventsByConversation.value).set(conversationId, []);
    teamMessagesByConversation.value = new Map(teamMessagesByConversation.value).set(conversationId, []);
  } finally {
    loadingEvents.value = false;
  }
}

function getConversationRunCount(conversationId: string): number {
  const persistedCount = teamEventCounts.value.get(conversationId) ?? 0;
  const liveCount = conversationStore
    .getTeamEvents(conversationId)
    .filter((event) => event.eventType === "team_run_start")
    .length;
  return Math.max(persistedCount, liveCount);
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

function abortSelectedRun() {
  if (!selectedConversationId.value) return;
  launchConversationId.value = selectedConversationId.value;
  abort();
}

function applyPromptTemplate(template: string) {
  teamPrompt.value = template;
}

function handleStartTeamRun() {
  const prompt = teamPrompt.value.trim();
  if (!prompt) return;
  if (!selectedTeamSwarmId.value) {
    showError("请先创建或选择一个 Team");
    return;
  }
  if (!connected.value) {
    connect();
    showError("WebSocket 未连接，正在重连，请稍后再试");
    return;
  }
  if (launchTarget.value === "current" && selectedConversationActive.value) {
    showError("当前 Team 会话仍在运行，请稍后再发起新任务");
    return;
  }

  const targetConversationId = launchTarget.value === "current" ? selectedConversationId.value : null;
  launchConversationId.value = targetConversationId;
  pendingNewConversation.value = !targetConversationId;
  inputText.value = prompt;
  sendMessage(selectedTeamSwarmId.value);
  teamPrompt.value = "";
}

function handleConversationCreated(event: Event) {
  if (!pendingNewConversation.value) return;
  const detail = (event as CustomEvent<{ conversationId?: unknown }>).detail;
  const conversationId = typeof detail?.conversationId === "string" ? detail.conversationId : "";
  if (!conversationId) return;
  pendingNewConversation.value = false;
  launchConversationId.value = conversationId;
  selectedConversationId.value = conversationId;
  void router.replace({ name: "team", params: { conversationId } });
  void refreshCreatedConversation(conversationId);
}

async function refreshCreatedConversation(conversationId: string) {
  try {
    await conversationStore.fetchAllConversations();
    teamEventCounts.value = new Map(teamEventCounts.value).set(
      conversationId,
      getConversationRunCount(conversationId),
    );
  } catch {
    // 实时事件已经进入运行态；列表刷新失败时保留当前工作台选择。
  }
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

      <section class="team-launch-card">
        <div class="team-launch-title">
          <SvgIcon name="send" :size="14" />
          <span>发起 Team Run</span>
        </div>
        <label>
          <span>Team</span>
          <select v-model="selectedTeamSwarmId" :disabled="teamSwarms.length === 0 || sending">
            <option v-for="swarm in teamSwarms" :key="swarm.id" :value="swarm.id">
              {{ swarm.name }}
            </option>
          </select>
        </label>
        <div class="launch-targets">
          <button
            type="button"
            :class="{ active: launchTarget === 'new' }"
            @click="launchTarget = 'new'"
          >
            新会话
          </button>
          <button
            type="button"
            :class="{ active: launchTarget === 'current' }"
            :disabled="!selectedConversation"
            @click="launchTarget = 'current'"
          >
            当前会话
          </button>
        </div>
        <textarea
          v-model="teamPrompt"
          rows="4"
          maxlength="4000"
          :disabled="sending || teamSwarms.length === 0"
          placeholder="输入要分析、发散或落地的需求..."
        />
        <div class="prompt-templates">
          <button type="button" @click="applyPromptTemplate('帮我做一次需求分析：目标用户、核心场景、功能范围、边界、风险和验收标准。')">
            需求分析
          </button>
          <button type="button" @click="applyPromptTemplate('围绕这个方向做头脑风暴：给出多种方案、适用场景、优缺点和推荐排序。')">
            头脑风暴
          </button>
          <button type="button" @click="applyPromptTemplate('把这个想法拆成可落地路线图：阶段、任务、依赖、风险和下一步行动。')">
            落地规划
          </button>
        </div>
        <button
          class="launch-submit"
          type="button"
          :disabled="!canSendPrompt"
          @click="handleStartTeamRun"
        >
          <SvgIcon :name="sending ? 'stop' : 'send'" :size="14" />
          {{ sending ? "运行中" : "启动 Team" }}
        </button>
        <p v-if="teamSwarms.length === 0" class="team-launch-hint">暂无 Team 配置，请先在 Swarms 中创建 Team 团队。</p>
        <p v-else-if="!connected" class="team-launch-hint">WebSocket 未连接，刷新后会自动重连。</p>
      </section>

      <label v-if="visibleTeamConversations.length > 0" class="team-search">
        <SvgIcon name="search" :size="14" />
        <input v-model="conversationSearch" type="search" placeholder="搜索 Team 会话..." />
      </label>

      <div v-if="loading" class="team-empty">加载中...</div>
      <div v-else-if="visibleTeamConversations.length === 0" class="team-empty">暂无 Team 运行记录</div>
      <div v-else-if="filteredTeamConversations.length === 0" class="team-empty">没有匹配的 Team 会话</div>
      <div v-else class="team-conversation-list">
        <button
          v-for="conversation in filteredTeamConversations"
          :key="conversation.id"
          type="button"
          class="team-conversation"
          :class="{ active: selectedConversationId === conversation.id }"
          @click="selectConversation(conversation.id)"
        >
          <span class="team-conversation-title">{{ conversation.title ?? "新对话" }}</span>
          <span class="team-conversation-meta">
            {{ getSwarmName(conversation) }} · {{ getConversationRunCount(conversation.id) }} Run
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
          <div class="workbench-actions">
            <span v-if="selectedConversationActive" class="running-badge">运行中</span>
            <button v-if="selectedConversationActive" type="button" @click="abortSelectedRun">
              <SvgIcon name="stop" :size="14" />
              终止
            </button>
            <button type="button" @click="openChat">
              <SvgIcon name="chat" :size="14" />
              打开对话
            </button>
          </div>
        </header>
        <div class="workbench-shell">
          <div v-if="loadingEvents" class="team-placeholder">Team 事件加载中...</div>
          <TeamTracePanel v-else :events="selectedEvents" :messages="selectedMessages" />
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

.team-launch-card {
  display: grid;
  gap: 10px;
  padding: 12px 14px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.team-launch-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.team-launch-card label {
  display: grid;
  gap: 5px;
}

.team-launch-card label span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.team-launch-card select,
.team-launch-card textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
}

.team-launch-card select {
  height: 34px;
  padding: 0 9px;
}

.team-launch-card textarea {
  min-height: 92px;
  max-height: 180px;
  resize: vertical;
  padding: 9px 10px;
  line-height: 1.55;
}

.team-launch-card select:focus,
.team-launch-card textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-bg);
}

.team-launch-card select:disabled,
.team-launch-card textarea:disabled,
.launch-targets button:disabled,
.launch-submit:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.launch-targets,
.prompt-templates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.launch-targets button,
.prompt-templates button,
.launch-submit {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.launch-targets button {
  flex: 1;
  padding: 0 10px;
}

.launch-targets button.active {
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.prompt-templates button {
  padding: 0 9px;
}

.launch-targets button:hover:not(:disabled),
.prompt-templates button:hover,
.launch-submit:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.launch-submit {
  width: 100%;
  gap: 6px;
  color: var(--text-primary);
  background: var(--color-accent-bg);
  border-color: var(--color-accent);
}

.team-launch-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.team-search {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 12px 0;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-muted);
}

.team-search:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-bg);
}

.team-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.team-search input::placeholder {
  color: var(--text-muted);
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

.workbench-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.running-badge {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-accent-bg);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
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

@media (max-width: 1024px) {
  .team-page {
    grid-template-columns: minmax(280px, 38%) minmax(0, 1fr);
  }
}

@media (max-width: 820px) {
  .team-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .team-list-pane {
    max-height: 48vh;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .workbench-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .workbench-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
