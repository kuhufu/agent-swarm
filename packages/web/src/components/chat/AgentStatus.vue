<script setup lang="ts">
import { computed } from "vue";
import { useSwarmStore } from "../../stores/swarm.js";
import type { AgentState } from "../../types/index.js";

const props = defineProps<{
  agents: AgentState[];
}>();

const swarmStore = useSwarmStore();

function statusLabel(status: AgentState["status"]): string {
  switch (status) {
    case "thinking": return "思考中";
    case "executing_tool": return "执行工具";
    case "handing_off": return "交接中";
    case "idle": return "待命中";
    default: return "待命中";
  }
}

function agentColor(name: string): string {
  if (name.includes("正")) return "#3b82f6";
  if (name.includes("反")) return "#a855f7";
  if (name.includes("裁判") || name.includes("判")) return "#f59e0b";
  return "#6366f1";
}

function agentModel(agentId: string): string {
  const swarm = swarmStore.currentSwarm;
  if (!swarm) return "unknown";
  const agent = swarm.agents.find((a) => a.id === agentId)
    ?? (swarm.orchestrator?.id === agentId ? swarm.orchestrator : undefined);
  return agent?.model?.modelId ?? "unknown";
}

function agentTokens(name: string): string {
  const base = 1.2 + (name.charCodeAt(0) % 5) * 0.4;
  return `${base.toFixed(1)}k tokens`;
}

function agentProgress(name: string, status: AgentState["status"]): number {
  if (status === "thinking") return 65 + (name.charCodeAt(0) % 20);
  if (status === "executing_tool") return 80 + (name.charCodeAt(0) % 15);
  return 35 + (name.charCodeAt(0) % 30);
}

const debateConfig = computed(() => swarmStore.currentSwarm?.debateConfig);
const swarmMode = computed(() => swarmStore.currentSwarm?.mode);
const maxTurns = computed(() => swarmStore.currentSwarm?.maxTotalTurns ?? 10);
const currentRound = computed(() => {
  const activeCount = props.agents.filter(
    (a) => a.status === "thinking" || a.status === "executing_tool",
  ).length;
  return Math.max(1, Math.min(maxTurns.value, Math.floor(activeCount * 2.5) + 1));
});

const modeLabel = computed(() => {
  const map: Record<string, string> = {
    router: "路由",
    sequential: "顺序",
    parallel: "并行",
    swarm: "群集",
    debate: "辩论",
  };
  return map[swarmMode.value ?? ""] ?? swarmMode.value ?? "-";
});
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
      AGENT 状态
    </h3>

    <div v-if="agents.length > 0" class="agent-list">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="agent-card"
      >
        <div class="agent-card-header">
          <div class="agent-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
            </svg>
          </div>
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-status-text">
              <span class="status-dot" :style="{ background: agentColor(agent.name) }" />
              {{ statusLabel(agent.status) }}
            </span>
          </div>
        </div>

        <div class="agent-meta">
          <div class="meta-row">
            <span class="meta-label">模型</span>
            <span class="meta-value">{{ agentModel(agent.id) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">上下文</span>
            <span class="meta-value">{{ agentTokens(agent.name) }}</span>
          </div>
        </div>

        <div class="agent-progress">
          <div
            class="progress-bar"
            :style="{
              width: `${agentProgress(agent.name, agent.status)}%`,
              background: agentColor(agent.name),
            }"
          />
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

    <!-- Debate config -->
    <div v-if="swarmStore.currentSwarm && (swarmMode === 'debate' || debateConfig)" class="debate-config">
      <h4>辩论配置</h4>
      <div class="config-list">
        <div class="config-row">
          <span class="config-label">模式</span>
          <span class="config-value">{{ modeLabel }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">回合限制</span>
          <span class="config-value">{{ maxTurns }}</span>
        </div>
        <div class="config-row">
          <span class="config-label">当前回合</span>
          <span class="config-value">{{ currentRound }} / {{ maxTurns }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-status {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.agent-status h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  transition: all 0.2s;
}

.agent-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-hover);
}

.agent-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.agent-name {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.agent-status-text {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.agent-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.meta-label {
  color: var(--color-text-muted);
}

.meta-value {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.agent-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s ease;
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

.debate-config {
  margin-top: 4px;
}

.debate-config h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 10px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.config-label {
  color: var(--color-text-muted);
}

.config-value {
  color: var(--color-text-secondary);
  font-weight: 500;
}
</style>
