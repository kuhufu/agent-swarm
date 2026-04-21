<script setup lang="ts">
import type { AgentState } from "../../types/index.js";

defineProps<{
  agents: AgentState[];
}>();

function statusLabel(status: AgentState["status"]): string {
  switch (status) {
    case "thinking": return "思考中";
    case "executing_tool": return "执行工具";
    case "handing_off": return "交接中";
    case "idle": return "空闲";
    default: return "空闲";
  }
}
</script>

<template>
  <div class="agent-status">
    <h3>Agent 状态</h3>
    <div v-if="agents.length > 0" class="agent-list">
      <div v-for="agent in agents" :key="agent.id" class="agent-item">
        <span :class="['agent-dot', agent.status]" />
        <span class="agent-name">{{ agent.name }}</span>
        <span class="agent-mode">{{ statusLabel(agent.status) }}</span>
      </div>
    </div>
    <div v-else class="no-agents">
      <p>暂无活跃 Agent</p>
    </div>
  </div>
</template>

<style scoped>
.agent-status {
  height: 100%;
}

.agent-status h3 {
  color: #c0c0c0;
  font-size: 14px;
  margin: 0 0 12px 0;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-dot.idle { background: #666; }
.agent-dot.thinking { background: #6366f1; animation: pulse 1s infinite; }
.agent-dot.executing_tool { background: #22c55e; }
.agent-dot.handing_off { background: #f59e0b; }

.agent-name {
  flex: 1;
  color: #c0c0c0;
  font-size: 13px;
}

.agent-mode {
  color: #888;
  font-size: 12px;
}

.no-agents {
  text-align: center;
  padding: 24px 0;
  color: #666;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
