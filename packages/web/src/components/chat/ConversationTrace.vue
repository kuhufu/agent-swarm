<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ConversationEvent } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";

const props = defineProps<{
  events: ConversationEvent[];
}>();

const expanded = ref(false);
const traceListRef = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const BOTTOM_THRESHOLD_PX = 24;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD_PX;
}

function updateAutoScrollState() {
  const el = traceListRef.value;
  if (!el) {
    return;
  }
  shouldAutoScroll.value = isNearBottom(el);
}

function scrollToBottom() {
  const el = traceListRef.value;
  if (!el) {
    return;
  }
  el.scrollTop = el.scrollHeight;
}

watch(expanded, async (nextExpanded) => {
  if (!nextExpanded) {
    return;
  }
  shouldAutoScroll.value = true;
  await nextTick();
  scrollToBottom();
}, { flush: "post" });

watch(() => props.events.length, async () => {
  if (!expanded.value) {
    return;
  }
  await nextTick();
  if (!shouldAutoScroll.value) {
    return;
  }
  scrollToBottom();
}, { flush: "post" });

function parseEventData(event: ConversationEvent): Record<string, any> {
  if (!event.eventData) {
    return {};
  }
  try {
    const parsed = JSON.parse(event.eventData) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

function eventLabel(event: ConversationEvent): string {
  const labels: Record<string, string> = {
    swarm_start: "开始",
    swarm_end: "结束",
    agent_start: "Agent 开始",
    agent_end: "Agent 结束",
    turn_start: "轮次开始",
    turn_end: "轮次结束",
    message_end: "消息完成",
    tool_execution_end: "工具完成",
    handoff: "交接",
    intervention_required: "需要介入",
    error: "错误",
  };
  return labels[event.eventType] ?? event.eventType;
}

function eventTone(event: ConversationEvent): string {
  if (event.eventType === "error") return "danger";
  if (event.eventType === "intervention_required") return "warning";
  if (event.eventType === "handoff") return "accent";
  if (event.eventType.startsWith("tool_")) return "tool";
  if (event.eventType === "swarm_start" || event.eventType === "swarm_end") return "system";
  return "default";
}

function eventAgent(event: ConversationEvent): string | null {
  const data = parseEventData(event);
  const agent = data.agentName ?? data.agentId ?? event.agentId;
  return typeof agent === "string" && agent.trim() ? agent : null;
}

function eventDetail(event: ConversationEvent): string {
  const data = parseEventData(event);
  if (event.eventType === "handoff") {
    const from = typeof data.fromAgentId === "string" ? data.fromAgentId : "unknown";
    const to = typeof data.toAgentId === "string" ? data.toAgentId : "unknown";
    const reason = typeof data.reason === "string" && data.reason.trim() ? ` · ${data.reason}` : "";
    return `${from} -> ${to}${reason}`;
  }
  if (event.eventType === "tool_execution_end") {
    const toolName = typeof data.toolName === "string" ? data.toolName : "unknown tool";
    return data.isError ? `${toolName} 执行失败` : `${toolName} 执行完成`;
  }
  if (event.eventType === "message_end") {
    const role = typeof data.role === "string" ? data.role : "assistant";
    return `${role} 消息完成`;
  }
  if (event.eventType === "error") {
    const error = data.error;
    if (error && typeof error === "object" && typeof error.message === "string") {
      return error.message;
    }
    if (typeof data.message === "string") {
      return data.message;
    }
    return "运行过程中发生错误";
  }
  return "";
}

function eventOffset(event: ConversationEvent): string {
  const first = props.events[0]?.timestamp;
  if (!first) {
    return "";
  }
  const diff = Math.max(0, event.timestamp - first);
  if (diff < 1000) return "+0.0s";
  if (diff < 60_000) return `+${(diff / 1000).toFixed(1)}s`;
  return `+${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
}
</script>

<template>
  <section class="trace-panel" :class="{ collapsed: !expanded }">
    <button class="trace-header" type="button" @click="expanded = !expanded">
      <h3>
        <SvgIcon name="pulse" :size="16" />
        执行 Trace
      </h3>
      <span class="trace-header-meta">
        <span v-if="events.length" class="trace-count">{{ events.length }}</span>
        <SvgIcon class="trace-chevron" :class="{ expanded }" name="chevronDown" :size="14" />
      </span>
    </button>

    <div
      v-if="expanded && events.length"
      ref="traceListRef"
      class="trace-list"
      @scroll="updateAutoScrollState"
    >
      <div
        v-for="event in events"
        :key="event.id"
        class="trace-item"
        :class="eventTone(event)"
      >
        <div class="trace-dot" />
        <div class="trace-body">
          <div class="trace-row">
            <span class="trace-label">{{ eventLabel(event) }}</span>
            <span class="trace-time">{{ eventOffset(event) }}</span>
          </div>
          <div v-if="eventAgent(event)" class="trace-agent">{{ eventAgent(event) }}</div>
          <div v-if="eventDetail(event)" class="trace-detail">{{ eventDetail(event) }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="expanded" class="trace-empty">暂无 Trace</div>
  </section>
</template>

<style scoped>
.trace-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  flex: 1;
}

.trace-panel.collapsed {
  flex: 0 0 auto;
}

.trace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.trace-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.trace-header:hover h3 {
  color: var(--text-primary);
}

.trace-header svg {
  width: 16px;
  height: 16px;
}

.trace-header-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.trace-count {
  font-size: 11px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 2px 7px;
  font-variant-numeric: tabular-nums;
}

.trace-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.trace-chevron.expanded {
  transform: rotate(180deg);
}

.trace-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.trace-list::-webkit-scrollbar {
  display: none;
}

.trace-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 8px;
  position: relative;
}

.trace-item::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 17px;
  bottom: -10px;
  width: 1px;
  background: var(--border-subtle);
}

.trace-item:last-child::before {
  display: none;
}

.trace-dot {
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 999px;
  background: var(--text-muted);
}

.trace-item.accent .trace-dot {
  background: var(--color-accent);
}

.trace-item.tool .trace-dot {
  background: #60a5fa;
}

.trace-item.warning .trace-dot {
  background: #fbbf24;
}

.trace-item.danger .trace-dot {
  background: #f87171;
}

.trace-item.system .trace-dot {
  background: #34d399;
}

.trace-body {
  min-width: 0;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
}

.trace-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.trace-label {
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.trace-time {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.trace-agent,
.trace-detail {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.trace-detail {
  color: var(--text-secondary);
}

.trace-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  border: 1px dashed var(--border-subtle);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
