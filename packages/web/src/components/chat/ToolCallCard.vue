<script setup lang="ts">
import { ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const expanded = ref(false);
</script>

<template>
  <div class="tool-call-card" @click="expanded = !expanded">
    <div class="tool-header">
      <span class="tool-icon">🔧</span>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span :class="['tool-status', toolCall.isError ? 'error' : 'success']">
        {{ toolCall.isError ? "失败" : "完成" }}
      </span>
    </div>
    <div v-if="expanded" class="tool-details">
      <div class="tool-args">
        <span class="label">参数：</span>
        <pre>{{ JSON.stringify(toolCall.arguments, null, 2) }}</pre>
      </div>
      <div v-if="toolCall.result" class="tool-result">
        <span class="label">结果：</span>
        <pre>{{ JSON.stringify(toolCall.result, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.2s;
}

.tool-call-card:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  font-size: 14px;
}

.tool-name {
  flex: 1;
  color: #c0c0c0;
  font-size: 13px;
  font-family: monospace;
}

.tool-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.tool-status.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.tool-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.label {
  color: #888;
  font-size: 12px;
}

pre {
  margin: 4px 0 8px;
  font-size: 12px;
  color: #a0a0a0;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
}
</style>
