<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ConversationEvent } from "../../types/index.js";
import { formatTimeLong } from "../../utils/format.js";
import {
  parseTeamEventData,
  teamEventLabel,
  teamEventRole,
  teamEventSeverity,
  teamEventSummary,
  teamRoleLabel,
  teamRunStatusLabel,
  teamSelectedRolesLabel,
  teamSkippedRolesLabel,
} from "../../utils/team-events.js";
import SvgIcon from "../common/SvgIcon.vue";

type WorkbenchView = "tasks" | "timeline";
type TaskFilter = "all" | "risk" | "active" | "completed";
type TimelineFilter = "all" | "risk" | "warning" | "run" | "task";

interface TeamTaskSummary {
  taskId: string;
  runId: string;
  agentId?: string;
  role: string;
  status: string;
  retryCount: number;
  summary: string;
  severity: "normal" | "warning" | "danger";
  createdAt: number;
  updatedAt: number;
  events: ConversationEvent[];
}

const props = defineProps<{
  events: ConversationEvent[];
}>();

const activeView = ref<WorkbenchView>("tasks");
const activeTaskFilter = ref<TaskFilter>("all");
const activeTimelineFilter = ref<TimelineFilter>("all");
const selectedTaskId = ref<string | null>(null);
const activeRunId = ref<string | null>(null);

const runIds = computed(() => {
  const ids: string[] = [];
  for (const event of props.events) {
    const runId = getEventRunId(event);
    if (runId && !ids.includes(runId)) ids.push(runId);
  }
  return ids;
});
const displayEvents = computed(() =>
  activeRunId.value
    ? props.events.filter((event) => getEventRunId(event) === activeRunId.value)
    : props.events,
);
const latestRunEvent = computed(() =>
  [...displayEvents.value].reverse().find((event) => event.eventType.startsWith("team_run_")) ?? null,
);
const latestTaskEvent = computed(() =>
  [...displayEvents.value].reverse().find((event) => event.eventType.startsWith("team_task_")) ?? null,
);
const latestRolePlanEvent = computed(() =>
  [...displayEvents.value].reverse().find((event) => teamSelectedRolesLabel(event)) ?? null,
);
const currentStatus = computed(() => {
  if (!latestRunEvent.value) return "暂无运行";
  return teamRunStatusLabel(parseTeamEventData(latestRunEvent.value).status);
});
const currentRole = computed(() => latestTaskEvent.value ? teamEventRole(latestTaskEvent.value) : null);
const selectedRoles = computed(() => latestRolePlanEvent.value ? teamSelectedRolesLabel(latestRolePlanEvent.value) : null);
const skippedRoles = computed(() => latestRolePlanEvent.value ? teamSkippedRolesLabel(latestRolePlanEvent.value) : null);
const riskCount = computed(() =>
  displayEvents.value.filter((event) => teamEventSeverity(event) === "danger").length,
);
const runSummary = computed(() => latestRunEvent.value ? teamEventSummary(latestRunEvent.value) : "暂无 Team 运行。");

const tasks = computed<TeamTaskSummary[]>(() => {
  const map = new Map<string, TeamTaskSummary>();

  for (const event of displayEvents.value) {
    if (!event.eventType.startsWith("team_task_")) continue;
    const data = parseTeamEventData(event);
    const taskId = typeof data.taskId === "string" ? data.taskId : event.id;
    const runId = typeof data.runId === "string" ? data.runId : "";
    const role = typeof data.role === "string" ? data.role : "team";
    const status = typeof data.status === "string" ? data.status : "running";
    const summary = teamEventSummary(event);
    const existing = map.get(taskId);
    const severity = strongerSeverity(existing?.severity ?? "normal", teamEventSeverity(event));

    if (!existing) {
      map.set(taskId, {
        taskId,
        runId,
        agentId: typeof data.agentId === "string" ? data.agentId : event.agentId ?? undefined,
        role,
        status,
        retryCount: typeof data.retryCount === "number" ? data.retryCount : 0,
        summary,
        severity,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        events: [event],
      });
      continue;
    }

    existing.agentId = typeof data.agentId === "string" ? data.agentId : existing.agentId;
    existing.role = role;
    existing.status = status;
    existing.retryCount = typeof data.retryCount === "number" ? data.retryCount : existing.retryCount;
    existing.summary = summary;
    existing.severity = severity;
    existing.updatedAt = event.timestamp;
    existing.events.push(event);
  }

  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
});

const taskFilterCounts = computed(() => ({
  all: tasks.value.length,
  risk: tasks.value.filter((task) => task.severity === "danger").length,
  active: tasks.value.filter((task) => isActiveTaskStatus(task.status)).length,
  completed: tasks.value.filter((task) => task.status === "completed").length,
}));

const filteredTasks = computed(() => {
  switch (activeTaskFilter.value) {
    case "risk":
      return tasks.value.filter((task) => task.severity === "danger");
    case "active":
      return tasks.value.filter((task) => isActiveTaskStatus(task.status));
    case "completed":
      return tasks.value.filter((task) => task.status === "completed");
    default:
      return tasks.value;
  }
});

const timelineFilterCounts = computed(() => ({
  all: displayEvents.value.length,
  risk: displayEvents.value.filter((event) => teamEventSeverity(event) === "danger").length,
  warning: displayEvents.value.filter((event) => teamEventSeverity(event) === "warning").length,
  run: displayEvents.value.filter((event) => event.eventType.startsWith("team_run_")).length,
  task: displayEvents.value.filter((event) => event.eventType.startsWith("team_task_")).length,
}));

const filteredTimelineEvents = computed(() => {
  switch (activeTimelineFilter.value) {
    case "risk":
      return displayEvents.value.filter((event) => teamEventSeverity(event) === "danger");
    case "warning":
      return displayEvents.value.filter((event) => teamEventSeverity(event) === "warning");
    case "run":
      return displayEvents.value.filter((event) => event.eventType.startsWith("team_run_"));
    case "task":
      return displayEvents.value.filter((event) => event.eventType.startsWith("team_task_"));
    default:
      return displayEvents.value;
  }
});

const selectedTask = computed(() =>
  filteredTasks.value.find((task) => task.taskId === selectedTaskId.value) ?? filteredTasks.value.at(-1) ?? null,
);

watch(filteredTasks, (items) => {
  if (items.length === 0) {
    selectedTaskId.value = null;
    return;
  }
  if (!selectedTaskId.value || !items.some((task) => task.taskId === selectedTaskId.value)) {
    selectedTaskId.value = items[items.length - 1]?.taskId ?? null;
  }
}, { immediate: true });

watch(runIds, (ids) => {
  if (ids.length === 0) {
    activeRunId.value = null;
    return;
  }
  if (!activeRunId.value || !ids.includes(activeRunId.value)) {
    activeRunId.value = ids[ids.length - 1] ?? null;
  }
}, { immediate: true });

function getEventRunId(event: ConversationEvent): string | null {
  const data = parseTeamEventData(event);
  return typeof data.runId === "string" && data.runId.length > 0 ? data.runId : null;
}

function runLabel(runId: string, index: number): string {
  const shortId = runId.slice(0, 8);
  return `Run ${index + 1} · ${shortId}`;
}

function strongerSeverity(
  left: "normal" | "warning" | "danger",
  right: "normal" | "warning" | "danger",
): "normal" | "warning" | "danger" {
  const rank = { normal: 0, warning: 1, danger: 2 };
  return rank[right] > rank[left] ? right : left;
}

function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "执行中",
    verifying: "审视中",
    completed: "已完成",
    failed: "失败",
    revision_required: "需修订",
    waiting_for_user: "等待用户",
    skipped: "已跳过",
  };
  return map[status] ?? status;
}

function taskFilterLabel(filter: TaskFilter): string {
  const map: Record<TaskFilter, string> = {
    all: "全部",
    risk: "风险",
    active: "进行中",
    completed: "已完成",
  };
  return map[filter];
}

function taskFilterCount(filter: TaskFilter): number {
  return taskFilterCounts.value[filter];
}

function timelineFilterLabel(filter: TimelineFilter): string {
  const map: Record<TimelineFilter, string> = {
    all: "全部",
    risk: "风险",
    warning: "警告",
    run: "Run",
    task: "Task",
  };
  return map[filter];
}

function timelineFilterCount(filter: TimelineFilter): number {
  return timelineFilterCounts.value[filter];
}

function isActiveTaskStatus(status: string): boolean {
  return status === "pending" || status === "running" || status === "verifying" || status === "revision_required" || status === "waiting_for_user";
}
</script>

<template>
  <div class="team-panel">
    <header class="team-panel-header">
      <div>
        <h3>Team 工作台</h3>
        <p>{{ displayEvents.length }} / {{ events.length }} 条事件</p>
      </div>
    </header>

    <section class="team-summary">
      <div>
        <span>状态</span>
        <strong>{{ currentStatus }}</strong>
      </div>
      <div>
        <span>执行角色</span>
        <strong :title="selectedRoles ?? currentRole ?? '无'">{{ selectedRoles ?? currentRole ?? "无" }}</strong>
      </div>
      <div>
        <span>风险</span>
        <strong :class="{ danger: riskCount > 0 }">{{ riskCount }} 条</strong>
      </div>
    </section>

    <section v-if="events.length > 0" class="run-brief">
      <p>{{ runSummary }}</p>
      <small v-if="skippedRoles">预算跳过：{{ skippedRoles }}</small>
    </section>

    <div v-if="runIds.length > 1" class="run-switcher">
      <button
        v-for="(runId, index) in runIds"
        :key="runId"
        type="button"
        :class="{ active: activeRunId === runId }"
        :title="runId"
        @click="activeRunId = runId"
      >
        {{ runLabel(runId, index) }}
      </button>
    </div>

    <div v-if="events.length === 0" class="team-empty">
      <SvgIcon name="history" :size="22" />
      <span>暂无 Team 事件</span>
    </div>

    <template v-else>
      <div class="workbench-tabs" role="tablist" aria-label="Team 工作台视图">
        <button
          type="button"
          :class="{ active: activeView === 'tasks' }"
          role="tab"
          :aria-selected="activeView === 'tasks'"
          @click="activeView = 'tasks'"
        >
          任务
          <span>{{ tasks.length }}</span>
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'timeline' }"
          role="tab"
          :aria-selected="activeView === 'timeline'"
          @click="activeView = 'timeline'"
        >
          时间线
          <span>{{ displayEvents.length }}</span>
        </button>
      </div>

      <div v-if="activeView === 'tasks'" class="task-workbench">
        <div v-if="tasks.length === 0" class="task-empty">暂无 Team 任务</div>
        <template v-else>
          <div class="task-filters" aria-label="任务筛选">
            <button
              v-for="filter in (['all', 'risk', 'active', 'completed'] as TaskFilter[])"
              :key="filter"
              type="button"
              :class="{ active: activeTaskFilter === filter }"
              @click="activeTaskFilter = filter"
            >
              {{ taskFilterLabel(filter) }}
              <span>{{ taskFilterCount(filter) }}</span>
            </button>
          </div>

          <div v-if="filteredTasks.length === 0" class="task-empty compact">当前筛选暂无任务</div>
          <div v-else class="task-list">
            <button
              v-for="task in filteredTasks"
              :key="task.taskId"
              type="button"
              class="task-row"
              :class="[task.severity, { active: selectedTask?.taskId === task.taskId }]"
              @click="selectedTaskId = task.taskId"
            >
              <span class="task-row-main">
                <span class="task-role">{{ teamRoleLabel(task.role) }}</span>
                <span class="task-summary">{{ task.summary }}</span>
              </span>
              <span class="task-row-meta">
                <span>{{ taskStatusLabel(task.status) }}</span>
                <span>{{ formatTimeLong(task.updatedAt) }}</span>
              </span>
            </button>
          </div>
        </template>

        <section v-if="selectedTask" class="task-detail">
          <header>
            <div>
              <span>{{ teamRoleLabel(selectedTask.role) }}</span>
              <strong>{{ taskStatusLabel(selectedTask.status) }}</strong>
            </div>
            <small v-if="selectedTask.retryCount > 0">重试 {{ selectedTask.retryCount }} 次</small>
          </header>
          <p>{{ selectedTask.summary }}</p>
          <dl>
            <div>
              <dt>Agent</dt>
              <dd>{{ selectedTask.agentId ?? "未记录" }}</dd>
            </div>
            <div>
              <dt>更新</dt>
              <dd>{{ formatTimeLong(selectedTask.updatedAt) }}</dd>
            </div>
          </dl>
          <div class="task-event-list">
            <article
              v-for="event in selectedTask.events"
              :key="event.id"
              class="mini-event"
              :class="teamEventSeverity(event)"
            >
              <div class="mini-event-header">
                <span>{{ teamEventLabel(event.eventType) }}</span>
                <small>{{ formatTimeLong(event.timestamp) }}</small>
              </div>
              <p>{{ teamEventSummary(event) }}</p>
              <small v-if="teamSkippedRolesLabel(event)" class="mini-event-note">跳过：{{ teamSkippedRolesLabel(event) }}</small>
            </article>
          </div>
        </section>
      </div>

      <div v-else class="team-timeline">
        <div class="timeline-filters" aria-label="时间线筛选">
          <button
            v-for="filter in (['all', 'risk', 'warning', 'run', 'task'] as TimelineFilter[])"
            :key="filter"
            type="button"
            :class="{ active: activeTimelineFilter === filter }"
            @click="activeTimelineFilter = filter"
          >
            {{ timelineFilterLabel(filter) }}
            <span>{{ timelineFilterCount(filter) }}</span>
          </button>
        </div>
        <div v-if="filteredTimelineEvents.length === 0" class="timeline-empty">当前筛选暂无事件</div>
        <article
          v-for="event in filteredTimelineEvents"
          :key="event.id"
          class="team-event"
          :class="teamEventSeverity(event)"
        >
          <div class="team-event-dot" />
          <div class="team-event-body">
            <div class="team-event-header">
              <span class="team-event-type">{{ teamEventLabel(event.eventType) }}</span>
              <span v-if="teamEventRole(event)" class="team-event-role">{{ teamEventRole(event) }}</span>
            </div>
            <p>{{ teamEventSummary(event) }}</p>
            <small v-if="teamSkippedRolesLabel(event)">跳过：{{ teamSkippedRolesLabel(event) }}</small>
            <time>{{ formatTimeLong(event.timestamp) }}</time>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.team-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-surface);
}

.team-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.team-panel-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.team-panel-header p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.team-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.team-summary div {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.team-summary span,
.team-summary strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-summary span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.team-summary strong {
  margin-top: 4px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.team-summary strong.danger {
  color: var(--color-danger);
}

.run-brief {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.run-brief p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.run-brief small {
  display: block;
  margin-top: 6px;
  color: var(--color-warning);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.run-switcher {
  display: flex;
  gap: 7px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}

.run-switcher button {
  flex: 0 0 auto;
  max-width: 150px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-switcher button:hover,
.run-switcher button.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.team-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.workbench-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.workbench-tabs button {
  min-width: 0;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.workbench-tabs button:hover,
.workbench-tabs button.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.workbench-tabs span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-workbench {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.task-empty {
  padding: 18px 14px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.task-empty.compact {
  padding: 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.task-filters {
  display: flex;
  gap: 7px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}

.task-filters button {
  flex: 0 0 auto;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.task-filters button:hover,
.task-filters button.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.task-filters span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-list {
  min-height: 0;
  max-height: 42%;
  overflow-y: auto;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.task-row {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  text-align: left;
  cursor: pointer;
}

.task-row + .task-row {
  margin-top: 8px;
}

.task-row:hover,
.task-row.active {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.task-row.warning {
  border-color: var(--border-warning);
}

.task-row.danger {
  border-color: var(--border-danger);
}

.task-row-main,
.task-row-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-role {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.task-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.task-row-meta {
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.task-detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.task-detail header div,
.task-detail dl div {
  min-width: 0;
}

.task-detail header span,
.task-detail header small,
.task-detail dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.task-detail header strong {
  display: block;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.task-detail p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.task-detail dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 12px 0;
}

.task-detail dt,
.task-detail dd {
  margin: 0;
}

.task-detail dd {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.task-event-list {
  display: grid;
  gap: 7px;
}

.mini-event {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.mini-event.warning {
  border-color: var(--border-warning);
  background: var(--bg-warning);
}

.mini-event.danger {
  border-color: var(--border-danger);
  background: var(--bg-danger);
}

.mini-event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.mini-event-header span {
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-event-header small {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.mini-event p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.mini-event-note {
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.team-timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 20px;
}

.timeline-filters {
  display: flex;
  gap: 7px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.timeline-filters button {
  flex: 0 0 auto;
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.timeline-filters button:hover,
.timeline-filters button.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.timeline-filters span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.timeline-empty {
  padding: 12px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.team-event {
  position: relative;
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 9px;
  padding-bottom: 12px;
}

.team-event:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: 0;
  width: 1px;
  background: var(--border-subtle);
}

.team-event-dot {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  box-shadow: 0 0 0 3px var(--bg-surface);
  z-index: 1;
}

.team-event.warning .team-event-dot {
  background: var(--color-warning);
}

.team-event.danger .team-event-dot {
  background: var(--color-danger);
}

.team-event-body {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.team-event.warning .team-event-body {
  border-color: var(--border-warning);
  background: var(--bg-warning);
}

.team-event.danger .team-event-body {
  border-color: var(--border-danger);
  background: var(--bg-danger);
}

.team-event-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 5px;
}

.team-event-type {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.team-event-role {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.team-event-body p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.team-event-body small {
  display: block;
  margin-top: 6px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.team-event-body time {
  display: block;
  margin-top: 7px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
