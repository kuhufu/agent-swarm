<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatMessage, ConversationEvent } from "../../types/index.js";
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
  teamStrategyLabel,
  teamTaskTypeLabel,
} from "../../utils/team-events.js";
import SvgIcon from "../common/SvgIcon.vue";
import { showError, showSuccess } from "../../utils/ui-feedback.js";

type WorkbenchView = "tasks" | "outputs" | "risks" | "timeline";
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

interface TeamOutputSummary {
  taskId: string;
  runId: string;
  role: string;
  status: string;
  summary: string;
  output: string;
  outputComplete: boolean;
  severity: "normal" | "warning" | "danger";
  updatedAt: number;
}

interface TeamRiskItem {
  id: string;
  runId: string | null;
  role: string | null;
  label: string;
  summary: string;
  note: string;
  severity: "warning" | "danger";
  timestamp: number;
}

const props = defineProps<{
  events: ConversationEvent[];
  messages?: ChatMessage[];
}>();

const activeView = ref<WorkbenchView>("tasks");
const activeTaskFilter = ref<TaskFilter>("all");
const activeTimelineFilter = ref<TimelineFilter>("all");
const selectedTaskId = ref<string | null>(null);
const activeRunId = ref<string | null>(null);
const copyingCurrentRun = ref(false);
const copyingAllRuns = ref(false);
const copyingRisks = ref(false);

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
const latestRoutingEvent = computed(() =>
  [...displayEvents.value].reverse().find((event) => {
    const data = parseTeamEventData(event);
    return data.routing && typeof data.routing === "object" && !Array.isArray(data.routing);
  }) ?? null,
);
const routingDecision = computed(() => {
  if (!latestRoutingEvent.value) return null;
  const data = parseTeamEventData(latestRoutingEvent.value);
  return data.routing && typeof data.routing === "object" && !Array.isArray(data.routing)
    ? data.routing as Record<string, unknown>
    : null;
});

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

const outputs = computed<TeamOutputSummary[]>(() =>
  tasks.value
    .filter((task) => task.status === "completed" || task.status === "failed")
    .map(taskToOutput),
);
const currentRunMarkdown = computed(() => buildOutputsMarkdown(displayEvents.value, "Team 当前 Run 产出"));
const allRunsMarkdown = computed(() => buildOutputsMarkdown(props.events, "Team 全部 Run 产出"));
const riskItems = computed<TeamRiskItem[]>(() =>
  displayEvents.value
    .map((event) => {
      const severity = teamEventSeverity(event);
      if (severity === "normal") return null;
      return {
        id: event.id,
        runId: getEventRunId(event),
        role: teamEventRole(event),
        label: teamEventLabel(event.eventType),
        summary: teamEventSummary(event),
        note: teamSkippedRolesLabel(event) ? `预算跳过：${teamSkippedRolesLabel(event)}` : "",
        severity,
        timestamp: event.timestamp,
      };
    })
    .filter((item): item is TeamRiskItem => Boolean(item))
    .sort((a, b) => b.timestamp - a.timestamp),
);
const risksMarkdown = computed(() => buildRisksMarkdown(riskItems.value));

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

function taskToOutput(task: TeamTaskSummary): TeamOutputSummary {
  const completedEvent = [...task.events].reverse().find(isTerminalTaskEvent);
  const data = completedEvent ? parseTeamEventData(completedEvent) : {};
  const fullOutput = typeof data.output === "string" && data.output.trim().length > 0
    ? data.output.trim()
    : "";
  const messageOutput = fullOutput ? "" : findTaskAssistantMessage(task);
  return {
    taskId: task.taskId,
    runId: task.runId,
    role: task.role,
    status: task.status,
    summary: task.summary,
    output: fullOutput || messageOutput || buildTaskSummaryFallback(task),
    outputComplete: Boolean(fullOutput || messageOutput),
    severity: task.severity,
    updatedAt: task.updatedAt,
  };
}

function findTaskAssistantMessage(task: TeamTaskSummary): string {
  if (!task.agentId || !props.messages || props.messages.length === 0) return "";
  const candidates = props.messages
    .filter((message) =>
      message.role === "assistant"
      && message.agentId === task.agentId
      && message.content.trim().length > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  if (candidates.length === 0) return "";

  const windowStart = task.createdAt - 60_000;
  const windowEnd = task.updatedAt + 60_000;
  const inWindow = candidates.filter((message) =>
    message.timestamp >= windowStart && message.timestamp <= windowEnd,
  );
  return (inWindow.at(-1) ?? candidates.at(-1))?.content.trim() ?? "";
}

function isTerminalTaskEvent(event: ConversationEvent): boolean {
  return event.eventType === "team_task_completed"
    || event.eventType === "team_task_verification_passed"
    || event.eventType === "team_task_verification_failed";
}

function buildTaskSummaryFallback(task: TeamTaskSummary): string {
  const summaries = task.events
    .map((event) => `- ${teamEventLabel(event.eventType)}：${teamEventSummary(event)}`)
    .filter((line, index, list) => list.indexOf(line) === index);
  if (summaries.length === 0) return task.summary;
  return [
    "此任务事件未包含完整 output，以下为可恢复的事件摘要：",
    ...summaries,
  ].join("\n");
}

function buildTasksFromEvents(events: ConversationEvent[]): TeamTaskSummary[] {
  const map = new Map<string, TeamTaskSummary>();
  for (const event of events) {
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
}

function buildOutputsMarkdown(events: ConversationEvent[], title: string): string {
  if (events.length === 0) return "";
  const lines = [`# ${title}`];
  const ids = getRunIdsFromEvents(events);
  const runGroups = ids.length > 0
    ? ids.map((runId) => ({ runId, events: events.filter((event) => getEventRunId(event) === runId) }))
    : [{ runId: "", events }];

  for (const [index, group] of runGroups.entries()) {
    if (runGroups.length > 1 || group.runId) {
      lines.push("", `## ${runLabel(group.runId || `run-${index + 1}`, index)}`);
    }
    appendRoutingMarkdown(lines, group.events);
    const runEnd = [...group.events].reverse().find((event) => event.eventType === "team_run_end");
    if (runEnd) {
      lines.push("", `**Run 结果：** ${teamEventSummary(runEnd)}`);
    }
    const runOutputs = buildTasksFromEvents(group.events)
      .filter((task) => task.status === "completed" || task.status === "failed")
      .map(taskToOutput);
    if (runOutputs.length === 0) {
      lines.push("", "暂无已完成角色产出。");
      continue;
    }
    for (const output of runOutputs) {
      lines.push(
        "",
        `### ${teamRoleLabel(output.role)} · ${taskStatusLabel(output.status)}`,
      );
      if (!output.outputComplete) {
        lines.push("", "> 注：该任务事件未包含完整 output，已复制可恢复的事件摘要。");
      }
      lines.push("", output.output);
    }
  }
  return lines.join("\n");
}

function getRunIdsFromEvents(events: ConversationEvent[]): string[] {
  const ids: string[] = [];
  for (const event of events) {
    const runId = getEventRunId(event);
    if (runId && !ids.includes(runId)) ids.push(runId);
  }
  return ids;
}

function appendRoutingMarkdown(lines: string[], events: ConversationEvent[]) {
  const routingEvent = [...events].reverse().find((event) => {
    const data = parseTeamEventData(event);
    return data.routing && typeof data.routing === "object" && !Array.isArray(data.routing);
  });
  if (!routingEvent) return;
  const routing = parseTeamEventData(routingEvent).routing as Record<string, unknown>;
  lines.push(
    "",
    `- 任务类型：${teamTaskTypeLabel(routing.taskType)}`,
    `- 协作策略：${teamStrategyLabel(routing.strategy)}`,
    `- Owner 理由：${String(routing.reason ?? "未记录")}`,
  );
}

function buildRisksMarkdown(items: TeamRiskItem[]): string {
  const lines = ["# Team 风险清单"];
  if (routingDecision.value) {
    lines.push(
      "",
      `- 任务类型：${teamTaskTypeLabel(routingDecision.value.taskType)}`,
      `- 协作策略：${teamStrategyLabel(routingDecision.value.strategy)}`,
      `- Owner 理由：${String(routingDecision.value.reason ?? "未记录")}`,
    );
  }
  if (items.length === 0) {
    lines.push("", "当前 Run 暂无风险或警告。");
    return lines.join("\n");
  }
  for (const item of items) {
    lines.push(
      "",
      `## ${item.severity === "danger" ? "阻塞" : "警告"} · ${item.label}`,
      "",
      `- 角色：${item.role ?? "Team"}`,
      `- 时间：${formatTimeLong(item.timestamp)}`,
      `- 摘要：${item.summary}`,
    );
    if (item.note) {
      lines.push(`- 备注：${item.note}`);
    }
  }
  return lines.join("\n");
}

async function copyMarkdown(
  markdown: string,
  state: typeof copyingCurrentRun | typeof copyingAllRuns | typeof copyingRisks,
  successMessage = "已复制",
) {
  if (!markdown || state.value) return;
  if (!navigator.clipboard) {
    showError("当前浏览器不支持剪贴板写入");
    return;
  }
  state.value = true;
  try {
    await navigator.clipboard.writeText(markdown);
    showSuccess(successMessage);
  } catch {
    showError("复制失败，请检查浏览器剪贴板权限");
  } finally {
    state.value = false;
  }
}

async function copyCurrentRunOutputs() {
  await copyMarkdown(currentRunMarkdown.value, copyingCurrentRun, "当前 Run 产出已复制");
}

async function copyAllRunOutputs() {
  await copyMarkdown(allRunsMarkdown.value, copyingAllRuns, "全部 Run 产出已复制");
}

async function copyRiskList() {
  await copyMarkdown(risksMarkdown.value, copyingRisks, "风险清单已复制");
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

    <section v-if="routingDecision" class="routing-brief">
      <div>
        <span>任务类型</span>
        <strong>{{ teamTaskTypeLabel(routingDecision.taskType) }}</strong>
      </div>
      <div>
        <span>协作策略</span>
        <strong>{{ teamStrategyLabel(routingDecision.strategy) }}</strong>
      </div>
      <p>{{ routingDecision.reason }}</p>
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
          :class="{ active: activeView === 'outputs' }"
          role="tab"
          :aria-selected="activeView === 'outputs'"
          @click="activeView = 'outputs'"
        >
          产出
          <span>{{ outputs.length }}</span>
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'risks' }"
          role="tab"
          :aria-selected="activeView === 'risks'"
          @click="activeView = 'risks'"
        >
          风险
          <span>{{ riskItems.length }}</span>
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

      <div v-else-if="activeView === 'outputs'" class="team-outputs">
        <div v-if="outputs.length === 0" class="output-empty">暂无角色产出</div>
        <template v-else>
          <div class="output-toolbar">
            <span>{{ outputs.length }} 份角色产出</span>
            <div class="output-actions">
              <button type="button" :disabled="copyingCurrentRun" @click="copyCurrentRunOutputs">
                <SvgIcon name="copy" :size="13" />
                {{ copyingCurrentRun ? "复制中" : "复制当前 Run" }}
              </button>
              <button
                type="button"
                :disabled="copyingAllRuns || runIds.length <= 1"
                @click="copyAllRunOutputs"
              >
                <SvgIcon name="copy" :size="13" />
                {{ copyingAllRuns ? "复制中" : "复制全部 Run" }}
              </button>
            </div>
          </div>
          <article
            v-for="output in outputs"
            :key="output.taskId"
            class="output-card"
            :class="output.severity"
          >
            <header>
              <div>
                <span>{{ teamRoleLabel(output.role) }}</span>
                <strong>{{ taskStatusLabel(output.status) }}</strong>
              </div>
              <time>{{ formatTimeLong(output.updatedAt) }}</time>
            </header>
            <p v-if="output.summary && output.summary !== output.output" class="output-summary">{{ output.summary }}</p>
            <p v-if="!output.outputComplete" class="output-warning">历史事件未包含完整 output，当前仅展示可恢复摘要。</p>
            <pre>{{ output.output }}</pre>
          </article>
        </template>
      </div>

      <div v-else-if="activeView === 'risks'" class="team-risks">
        <div v-if="riskItems.length === 0" class="risk-empty">当前 Run 暂无风险或警告</div>
        <template v-else>
          <div class="risk-toolbar">
            <span>{{ riskItems.length }} 条风险与警告</span>
            <button type="button" :disabled="copyingRisks" @click="copyRiskList">
              <SvgIcon name="copy" :size="13" />
              {{ copyingRisks ? "复制中" : "复制风险清单" }}
            </button>
          </div>
          <article
            v-for="item in riskItems"
            :key="item.id"
            class="risk-card"
            :class="item.severity"
          >
            <header>
              <div>
                <span>{{ item.label }}</span>
                <strong>{{ item.role ?? "Team" }}</strong>
              </div>
              <time>{{ formatTimeLong(item.timestamp) }}</time>
            </header>
            <p>{{ item.summary }}</p>
            <small v-if="item.note">{{ item.note }}</small>
          </article>
        </template>
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

.routing-brief {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.routing-brief div {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.routing-brief span,
.routing-brief strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.routing-brief span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.routing-brief strong {
  margin-top: 3px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.routing-brief p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.55;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.team-outputs {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 12px 14px 20px;
}

.output-empty {
  padding: 12px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.output-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.output-toolbar span {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.output-toolbar button {
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

.output-toolbar button:hover:not(:disabled) {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.output-toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.output-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
}

.output-card {
  min-width: 0;
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.output-card.warning {
  border-color: var(--border-warning);
  background: var(--bg-warning);
}

.output-card.danger {
  border-color: var(--border-danger);
  background: var(--bg-danger);
}

.output-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.output-card header div {
  min-width: 0;
}

.output-card header span,
.output-card time {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.output-card header strong {
  display: block;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.output-card time {
  flex: 0 0 auto;
}

.output-summary {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.output-warning {
  margin: 0;
  padding: 8px 9px;
  border: 1px solid var(--border-warning);
  border-radius: var(--radius-sm);
  background: var(--bg-warning);
  color: var(--color-warning);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.output-card pre {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);
  line-height: 1.65;
}

.team-risks {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 12px 14px 20px;
}

.risk-empty {
  padding: 12px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.risk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.risk-toolbar span {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk-toolbar button {
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

.risk-toolbar button:hover:not(:disabled) {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.risk-toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.risk-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--border-warning);
  border-radius: var(--radius-md);
  background: var(--bg-warning);
}

.risk-card.danger {
  border-color: var(--border-danger);
  background: var(--bg-danger);
}

.risk-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.risk-card header div {
  min-width: 0;
}

.risk-card header span,
.risk-card time,
.risk-card small {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.risk-card header strong {
  display: block;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.risk-card time {
  flex: 0 0 auto;
}

.risk-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.risk-card small {
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
