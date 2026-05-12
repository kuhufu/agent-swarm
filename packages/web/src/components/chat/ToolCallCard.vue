<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";
import ToolRawDataPanel from "./ToolRawDataPanel.vue";
import ToolResultRenderer from "./ToolResultRenderer.vue";
import {
  formatDuration,
  getToolColorClass,
  getToolIcon,
  getToolLabel,
  getToolParamSummary,
  getToolStatus,
} from "./tool-card-utils.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const expanded = ref(false);

const toolLabel = computed(() => getToolLabel(props.toolCall.name));
const colorClass = computed(() => getToolColorClass(props.toolCall.name));
const toolIcon = computed(() => getToolIcon(props.toolCall.name));
const paramSummary = computed(() => getToolParamSummary(props.toolCall.arguments));
const formattedDuration = computed(() => formatDuration(props.toolCall.durationMs));
const status = computed(() => getToolStatus(props.toolCall));

</script>

<template>
  <div class="tool-call-card" :class="{ expanded }" @click="expanded = !expanded">
    <div class="tool-header">
      <div :class="['tool-icon-wrapper', colorClass]">
        <SvgIcon :name="toolIcon" :size="12" />
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
      <ToolResultRenderer :tool-call="toolCall" />
      <ToolRawDataPanel :tool-call="toolCall" />
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-shadow: var(--shadow-sm);
}

.tool-call-card:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
  box-shadow: var(--shadow-md);
}

.tool-call-card.expanded {
  border-color: var(--border-default);
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
  color: var(--text-secondary);
}
.tool-icon-wrapper.file {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
}
.tool-icon-wrapper:not(.search):not(.knowledge):not(.code):not(.handoff):not(.file) {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.tool-icon-wrapper svg {
  width: 12px;
  height: 12px;
}

.tool-name {
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-family: var(--font-mono);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}

.tool-param-summary {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-surface);
}

.tool-duration {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.tool-status {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--text-sm);
  padding: 3px 10px;
  border-radius: 9999px;
  font-weight: var(--weight-bold);
}

.tool-status.success {
  background: var(--bg-success);
  color: var(--color-success);
}

.tool-status.error {
  background: var(--bg-danger);
  color: var(--color-danger);
}

.tool-status.running {
  background: var(--bg-warning);
  color: var(--color-warning);
}

.expand-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.tool-details {
  padding: 0 14px 14px;
  border-top: 1px solid var(--border-subtle);
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

.tool-details :deep(.tool-section) {
  margin-top: 6px;
}

</style>
