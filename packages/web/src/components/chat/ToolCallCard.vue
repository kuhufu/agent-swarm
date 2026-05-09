<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";
import ToolRawDataPanel from "./ToolRawDataPanel.vue";
import ToolResultRenderer from "./ToolResultRenderer.vue";
import type { WorkspaceNextAction } from "./tool-card-utils.js";
import {
  formatDuration,
  getToolColorClass,
  getToolLabel,
  getToolParamSummary,
  getToolStatus,
  getToolStatusIcon,
} from "./tool-card-utils.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const expanded = ref(false);

const toolLabel = computed(() => getToolLabel(props.toolCall.name));
const colorClass = computed(() => getToolColorClass(props.toolCall.name));
const paramSummary = computed(() => getToolParamSummary(props.toolCall.arguments));
const formattedDuration = computed(() => formatDuration(props.toolCall.durationMs));
const status = computed(() => getToolStatus(props.toolCall));
const statusIcon = computed(() => getToolStatusIcon(props.toolCall));

function handleApplyNextAction(action: WorkspaceNextAction) {
  const text = `${action.tool}${action.params ? " " + JSON.stringify(action.params) : ""}`;
  window.dispatchEvent(new CustomEvent("agent-swarm:fill-input", { detail: { text } }));
}
</script>

<template>
  <div class="tool-call-card" :class="{ expanded }" @click="expanded = !expanded">
    <div class="tool-header">
      <div :class="['tool-icon-wrapper', colorClass]">
        <SvgIcon :name="statusIcon" :size="12" />
      </div>
      <span class="tool-name">{{ toolLabel }}</span>
      <span v-if="paramSummary" class="tool-param-summary" :title="paramSummary">{{ paramSummary }}</span>
      <span v-if="formattedDuration" class="tool-duration">{{ formattedDuration }}</span>
      <span :class="['tool-status', status.cls]">
        {{ status.label }}
      </span>
      <SvgIcon class="expand-icon" :class="{ rotated: expanded }" name="chevronDown" :size="14" />
    </div>
    <div v-if="expanded" class="tool-details">
      <ToolResultRenderer :tool-call="toolCall" @apply-next-action="handleApplyNextAction" />
      <ToolRawDataPanel :tool-call="toolCall" />
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.tool-call-card:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: var(--color-border-hover);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.tool-call-card.expanded {
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 0 0 1px rgba(99,102,241,0.08);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.tool-icon-wrapper {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.2s, color 0.2s;
}
.tool-icon-wrapper.search {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}
.tool-icon-wrapper.knowledge {
  background: rgba(20, 184, 166, 0.12);
  color: #2dd4bf;
}
.tool-icon-wrapper.code {
  background: rgba(251, 146, 60, 0.12);
  color: #fb923c;
}
.tool-icon-wrapper.handoff {
  background: rgba(168, 85, 247, 0.12);
  color: #c084fc;
}
.tool-icon-wrapper.file {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
}
.tool-icon-wrapper:not(.search):not(.knowledge):not(.code):not(.handoff):not(.file) {
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-accent-light);
}
.tool-icon-wrapper svg {
  width: 12px;
  height: 12px;
}

.tool-name {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-family: var(--font-mono);
  font-weight: 500;
  flex-shrink: 0;
}

.tool-param-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
}

.tool-duration {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.tool-status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-weight: 600;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success);
}

.tool-status.error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.tool-status.running {
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-warning);
}

.expand-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.tool-details {
  padding: 0 14px 14px;
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 0;
  overflow: hidden;
  animation: expandIn 0.2s ease both;
}
@keyframes expandIn {
  from {
    max-height: 0;
    opacity: 0;
    padding-top: 0;
    padding-bottom: 0;
  }
  to {
    max-height: 2000px;
    opacity: 1;
  }
}

.tool-section {
  margin-top: 12px;
}

</style>
