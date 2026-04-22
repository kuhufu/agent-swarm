<script setup lang="ts">
import { computed } from "vue";
import { useSwarmStore } from "../../stores/swarm.js";
import type { AgentState } from "../../types/index.js";

const props = defineProps<{
  agents: AgentState[];
}>();

const swarmStore = useSwarmStore();

const swarmInfo = computed(() => {
  const swarm = swarmStore.currentSwarm;
  if (!swarm) return null;
  const modeMap: Record<string, string> = {
    router: "路由",
    sequential: "顺序",
    parallel: "并行",
    swarm: "群集",
    debate: "辩论",
  };
  return {
    name: swarm.name,
    mode: modeMap[swarm.mode] ?? swarm.mode,
    agentCount: swarm.agents.length,
  };
});

function statusLabel(status: AgentState["status"]): string {
  switch (status) {
    case "thinking": return "思考中";
    case "executing_tool": return "执行工具";
    case "handing_off": return "交接中";
    case "idle": return "待命中";
    default: return "待命中";
  }
}

const COLORS = ["#6366f1", "#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#06b6d4"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function agentColor(agentId: string): string {
  return COLORS[hashId(agentId) % COLORS.length];
}

function getAgentConfig(agentId: string) {
  const swarm = swarmStore.currentSwarm;
  if (!swarm) return null;
  return swarm.agents.find((a) => a.id === agentId)
    ?? (swarm.orchestrator?.id === agentId ? swarm.orchestrator : undefined)
    ?? null;
}

function agentModelLabel(agentId: string): string {
  const config = getAgentConfig(agentId);
  if (!config?.model) return "unknown";
  return `${config.model.provider}/${config.model.modelId}`;
}

function agentDescription(agentId: string): string {
  const config = getAgentConfig(agentId);
  return config?.description ?? "";
}

function agentSystemPrompt(agentId: string): string {
  const config = getAgentConfig(agentId);
  if (!config?.systemPrompt) return "";
  const lines = config.systemPrompt.split("\n").filter(Boolean);
  return lines[0] ?? "";
}


</script>

<template>
  <div class="agent-status">
    <div class="status-section">
      <h3>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        AGENT 状态
      </h3>

      <div v-if="swarmInfo" class="swarm-info-bar">
        <span class="swarm-badge">{{ swarmInfo.mode }}</span>
        <span class="swarm-name">{{ swarmInfo.name }}</span>
      </div>
    </div>

    <div v-if="agents.length > 0" class="agent-list">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="agent-card"
      >
        <div class="agent-card-header">
          <div class="agent-avatar" :style="{ borderColor: agentColor(agent.id) }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
            </svg>
          </div>
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-status-text">
              <span class="status-dot" :style="{ background: agentColor(agent.id) }" />
              {{ statusLabel(agent.status) }}
            </span>

          </div>
        </div>

        <div v-if="agentDescription(agent.id)" class="agent-desc">
          {{ agentDescription(agent.id) }}
        </div>

        <div class="agent-meta">
          <div class="meta-row">
            <span class="meta-label">模型</span>
            <span class="meta-value">{{ agentModelLabel(agent.id) }}</span>
          </div>
          <div v-if="agentSystemPrompt(agent.id)" class="meta-row">
            <span class="meta-label">指令</span>
            <span class="meta-value mono">{{ agentSystemPrompt(agent.id) }}</span>
          </div>
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
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-section h3 {
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

.swarm-info-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
}

.swarm-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(99, 102, 241, 0.15);
  color: var(--color-accent-light);
  flex-shrink: 0;
}

.swarm-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.agent-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-muted);
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
}

.agent-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  min-width: 0;
}

.meta-label {
  color: var(--color-text-muted);
  flex-shrink: 0;
  margin-right: 8px;
}

.meta-value {
  color: var(--color-text-secondary);
  font-weight: 500;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-value.mono {
  font-family: var(--font-mono);
  font-size: 11px;
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
