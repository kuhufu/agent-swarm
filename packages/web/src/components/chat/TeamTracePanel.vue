<script setup lang="ts">
import { computed } from "vue";
import type { ConversationEvent } from "../../types/index.js";
import { formatTimeLong } from "../../utils/format.js";
import { parseTeamEventData, teamEventLabel, teamEventRole, teamEventSeverity, teamEventSummary, teamRunStatusLabel, teamSelectedRolesLabel, teamSkippedRolesLabel } from "../../utils/team-events.js";
import SvgIcon from "../common/SvgIcon.vue";

const props = defineProps<{
  events: ConversationEvent[];
}>();

const latestRunEvent = computed(() =>
  [...props.events].reverse().find((event) => event.eventType.startsWith("team_run_")) ?? null,
);
const latestTaskEvent = computed(() =>
  [...props.events].reverse().find((event) => event.eventType.startsWith("team_task_")) ?? null,
);
const latestRolePlanEvent = computed(() =>
  [...props.events].reverse().find((event) => teamSelectedRolesLabel(event)) ?? null,
);
const currentStatus = computed(() => {
  if (!latestRunEvent.value) return "暂无运行";
  return teamRunStatusLabel(parseTeamEventData(latestRunEvent.value).status);
});
const currentRole = computed(() => latestTaskEvent.value ? teamEventRole(latestTaskEvent.value) : null);
const selectedRoles = computed(() => latestRolePlanEvent.value ? teamSelectedRolesLabel(latestRolePlanEvent.value) : null);
const riskCount = computed(() =>
  props.events.filter((event) => teamEventSeverity(event) === "danger").length,
);
</script>

<template>
  <div class="team-panel">
    <header class="team-panel-header">
      <div>
        <h3>Team 过程</h3>
        <p>{{ events.length }} 条事件</p>
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

    <div v-if="events.length === 0" class="team-empty">
      <SvgIcon name="history" :size="22" />
      <span>暂无 Team 事件</span>
    </div>

    <div v-else class="team-timeline">
      <article
        v-for="event in events"
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
  border-radius: 8px;
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
  border-radius: 8px;
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
