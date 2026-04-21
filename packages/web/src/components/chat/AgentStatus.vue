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

function statusIcon(status: AgentState["status"]): string {
  switch (status) {
    case "thinking": return "thinking";
    case "executing_tool": return "executing";
    case "handing_off": return "handing";
    case "idle": return "idle";
    default: return "idle";
  }
}
</script>

<template>
  <div class="agent-status">
    <h3>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Agent 状态
    </h3>
    <div v-if="agents.length > 0" class="agent-list">
      <div v-for="agent in agents" :key="agent.id" class="agent-item">
        <div class="agent-main">
          <div class="agent-avatar">
            <span class="agent-initial">{{ agent.name.charAt(0).toUpperCase() }}</span>
            <span :class="['status-dot', agent.status]" />
          </div>
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-status-text">{{ statusLabel(agent.status) }}</span>
          </div>
        </div>
        <div :class="['status-badge', agent.status]">
          <span v-if="agent.status === 'thinking'" class="pulse-ring" />
          {{ statusLabel(agent.status) }}
        </div>
      </div>
    </div>
    <div v-else class="no-agents">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 32px; margin-bottom: 8px;">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p>暂无活跃 Agent</p>
      <span>开始对话后将显示 Agent 状态</span>
    </div>
  </div>
</template>

<style scoped>
.agent-status {
  height: 100%;
}

.agent-status h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 16px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  transition: all 0.2s;
}

.agent-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-hover);
}

.agent-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-avatar {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.agent-initial {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent-light);
}

.status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--color-surface-2);
}

.status-dot.idle { background: #6b7280; }
.status-dot.thinking { background: var(--color-accent); }
.status-dot.executing_tool { background: var(--color-success); }
.status-dot.handing_off { background: var(--color-warning); }

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-name {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.agent-status-text {
  color: var(--color-text-muted);
  font-size: 11px;
}

.status-badge {
  position: relative;
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
}

.status-badge.idle {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
}

.status-badge.thinking {
  background: rgba(99, 102, 241, 0.15);
  color: var(--color-accent-light);
}

.status-badge.executing_tool {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.status-badge.handing_off {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.3);
  animation: pulseRing 2s ease-out infinite;
}

@keyframes pulseRing {
  0% { transform: scale(1); opacity: 0.5; }
  100% { transform: scale(1.5); opacity: 0; }
}

.no-agents {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 16px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.no-agents p {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.no-agents span {
  font-size: 12px;
}
</style>
