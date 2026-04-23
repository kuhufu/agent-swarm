<script setup lang="ts">
import type { InterventionPoint, InterventionStrategy } from "../../types/index.js";

defineProps<{
  interventions: Partial<Record<InterventionPoint, InterventionStrategy>>;
}>();

const emit = defineEmits<{
  (e: "update", point: InterventionPoint, strategy: InterventionStrategy): void;
}>();

const interventionPoints: { key: InterventionPoint; label: string }[] = [
  { key: "before_agent_start", label: "Agent 启动前" },
  { key: "after_agent_end", label: "Agent 结束后" },
  { key: "before_tool_call", label: "工具调用前" },
  { key: "after_tool_call", label: "工具调用后" },
  { key: "on_handoff", label: "Agent 交接时" },
  { key: "on_error", label: "发生错误时" },
  { key: "on_approval_required", label: "需要审批时" },
];

const strategyOptions: { value: InterventionStrategy; label: string; color: string }[] = [
  { value: "auto", label: "自动批准", color: "#22c55e" },
  { value: "confirm", label: "确认", color: "#6366f1" },
  { value: "review", label: "审查", color: "#f59e0b" },
  { value: "edit", label: "编辑", color: "#3b82f6" },
  { value: "reject", label: "拒绝", color: "#ef4444" },
];
</script>

<template>
  <div>
    <div class="content-header">
      <h3>全局介入策略</h3>
      <p>配置各介入点的默认策略</p>
    </div>

    <div class="intervention-list">
      <div v-for="point in interventionPoints" :key="point.key" class="intervention-row card">
        <span class="intervention-label">{{ point.label }}</span>
        <div class="strategy-options">
          <button
            v-for="opt in strategyOptions"
            :key="opt.value"
            class="strategy-btn"
            :class="{ active: interventions[point.key] === opt.value }"
            :style="interventions[point.key] === opt.value ? { background: opt.color + '20', color: opt.color, borderColor: opt.color + '40' } : {}"
            @click="emit('update', point.key, opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-header {
  margin-bottom: 24px;
}
.content-header h3 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.content-header p {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}
.intervention-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.intervention-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
}
.intervention-label {
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
}
.strategy-options {
  display: flex;
  gap: 6px;
}
.strategy-btn {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.strategy-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}
.strategy-btn.active {
  border-width: 1px;
}
</style>
