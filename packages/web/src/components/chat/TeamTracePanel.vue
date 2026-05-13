<script setup lang="ts">
import type { ConversationEvent } from "../../types/index.js";
import { formatTimeLong } from "../../utils/format.js";
import SvgIcon from "../common/SvgIcon.vue";

defineProps<{
  events: ConversationEvent[];
}>();

function parseEventData(event: ConversationEvent): Record<string, unknown> {
  if (!event.eventData) return {};
  try {
    const parsed = JSON.parse(event.eventData) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function teamRoleLabel(role: unknown): string {
  const map: Record<string, string> = {
    analyst: "需求分析",
    ideator: "方案发散",
    critic: "风险审视",
    synthesizer: "结论汇总",
    researcher: "研究调研",
    developer: "实现分析",
    tester: "验证设计",
    reviewer: "方案评审",
    owner: "Owner",
  };
  return typeof role === "string" ? map[role] ?? role : "Team";
}

function eventLabel(eventType: string): string {
  const map: Record<string, string> = {
    team_run_start: "开始规划",
    team_run_update: "路由决策",
    team_run_end: "运行结束",
    team_task_created: "创建任务",
    team_task_started: "开始任务",
    team_task_update: "任务更新",
    team_task_completed: "任务完成",
    team_task_verification_started: "开始审视",
    team_task_verification_passed: "审视通过",
    team_task_verification_failed: "审视失败",
    team_task_retry: "任务重试",
    team_task_human_review_required: "需要人工介入",
  };
  return map[eventType] ?? eventType;
}

function eventSummary(event: ConversationEvent): string {
  const data = parseEventData(event);
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  if (summary) return summary;

  const routing = data.routing && typeof data.routing === "object" && !Array.isArray(data.routing)
    ? data.routing as Record<string, unknown>
    : null;
  const reason = typeof routing?.reason === "string" ? routing.reason.trim() : "";
  if (reason) return reason;

  return typeof data.status === "string" ? data.status : "已记录 Team 事件";
}

function eventRole(event: ConversationEvent): string | null {
  const data = parseEventData(event);
  return "role" in data ? teamRoleLabel(data.role) : null;
}
</script>

<template>
  <div class="team-panel">
    <header class="team-panel-header">
      <div>
        <h3>Team 过程</h3>
        <p>{{ events.length }} 条事件</p>
      </div>
    </header>

    <div v-if="events.length === 0" class="team-empty">
      <SvgIcon name="history" :size="22" />
      <span>暂无 Team 事件</span>
    </div>

    <div v-else class="team-timeline">
      <article v-for="event in events" :key="event.id" class="team-event">
        <div class="team-event-dot" />
        <div class="team-event-body">
          <div class="team-event-header">
            <span class="team-event-type">{{ eventLabel(event.eventType) }}</span>
            <span v-if="eventRole(event)" class="team-event-role">{{ eventRole(event) }}</span>
          </div>
          <p>{{ eventSummary(event) }}</p>
          <time>{{ formatTimeLong(event.timestamp) }}</time>
        </div>
      </article>
    </div>
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

.team-timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 20px;
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
  background: var(--color-accent);
  box-shadow: 0 0 0 3px var(--bg-surface);
  z-index: 1;
}

.team-event-body {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-card);
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
  border-radius: 6px;
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

.team-event-body time {
  display: block;
  margin-top: 7px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
