<script setup lang="ts">
import { ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const expanded = ref(false);
</script>

<template>
  <div class="tool-call-card" :class="{ expanded }" @click="expanded = !expanded">
    <div class="tool-header">
      <div class="tool-icon-wrapper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span :class="['tool-status', toolCall.isError ? 'error' : 'success']">
        {{ toolCall.isError ? "失败" : "完成" }}
      </span>
      <svg
        class="expand-icon"
        :class="{ rotated: expanded }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    <div v-if="expanded" class="tool-details">
      <div class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          参数
        </span>
        <pre>{{ JSON.stringify(toolCall.arguments, null, 2) }}</pre>
      </div>
      <div v-if="toolCall.result" class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          结果
        </span>
        <pre>{{ JSON.stringify(toolCall.result, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}

.tool-call-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-hover);
}

.tool-call-card.expanded {
  border-color: rgba(99, 102, 241, 0.2);
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
  background: rgba(99, 102, 241, 0.1);
  border-radius: 6px;
  color: var(--color-accent-light);
}

.tool-icon-wrapper svg {
  width: 12px;
  height: 12px;
}

.tool-name {
  flex: 1;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-family: var(--font-mono);
  font-weight: 500;
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
}

.tool-section {
  margin-top: 12px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  line-height: 1.6;
  border: 1px solid var(--color-border-subtle);
}
</style>
