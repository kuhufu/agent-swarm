<script setup lang="ts">
import { computed } from "vue";
import SvgIcon from "../common/SvgIcon.vue";
import { useSwarmStore } from "../../stores/swarm.js";
import { agentColor } from "../../utils/agent-color.js";
import { MODE_LABEL_ZH } from "../../constants/swarm-modes.js";
import type { AgentState } from "../../types/index.js";

const props = defineProps<{
  agents: AgentState[];
  swarmId?: string | null;
}>();

const swarmStore = useSwarmStore();

const swarmInfo = computed(() => {
  const swarm = swarmStore.getSwarmById(props.swarmId);
  if (!swarm) return null;
  return {
    name: swarm.name,
    mode: MODE_LABEL_ZH[swarm.mode] ?? swarm.mode,
    agentCount: swarm.agents.length,
  };
});

/** Configured agents from the current Swarm (shown before conversation starts) */
const configuredAgents = computed(() => {
  const swarm = swarmStore.getSwarmById(props.swarmId);
  return swarm?.agents ?? [];
});

const displayedAgents = computed(() => {
  const swarm = swarmStore.getSwarmById(props.swarmId);
  if (!swarm) {
    return props.agents;
  }
  const allowedAgentIds = new Set(swarm.agents.map((agent) => agent.id));
  return props.agents.filter((agent) => allowedAgentIds.has(agent.id));
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

function getAgentConfig(agentId: string) {
  const swarm = swarmStore.getSwarmById(props.swarmId);
  if (!swarm) return null;
  return swarm.agents.find((a) => a.id === agentId) ?? null;
}

function agentModelLabel(agent: AgentState): string {
  if (agent.model) {
    return `${agent.model.provider}/${agent.model.modelId}`;
  }
  const config = getAgentConfig(agent.id);
  if (!config?.model) return "unknown";
  return `${config.model.provider}/${config.model.modelId}`;
}

function agentDescription(agent: AgentState): string {
  if (typeof agent.description === "string" && agent.description.length > 0) {
    return agent.description;
  }
  const config = getAgentConfig(agent.id);
  return config?.description ?? "";
}

function agentSystemPrompt(agent: AgentState): string {
  const prompt = (
    typeof agent.systemPrompt === "string" && agent.systemPrompt.length > 0
      ? agent.systemPrompt
      : getAgentConfig(agent.id)?.systemPrompt
  );
  if (!prompt) return "";
  const lines = prompt.split("\n").filter(Boolean);
  return lines[0] ?? "";
}


</script>

<template>
  <div class="agent-status">
    <div class="status-section">
      <h3>
        <SvgIcon name="user" :size="16" />
        AGENT 状态
      </h3>

      <div v-if="swarmInfo" class="swarm-info-bar">
        <span class="swarm-badge">{{ swarmInfo.mode }}</span>
        <span class="swarm-name">{{ swarmInfo.name }}</span>
      </div>
    </div>

    <div v-if="displayedAgents.length > 0" class="agent-list">
      <div
        v-for="agent in displayedAgents"
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

        <div v-if="agentDescription(agent)" class="agent-desc">
          {{ agentDescription(agent) }}
        </div>

        <div class="agent-meta">
          <div class="meta-row">
            <span class="meta-label">模型</span>
            <span class="meta-value">{{ agentModelLabel(agent) }}</span>
          </div>
          <div v-if="agentSystemPrompt(agent)" class="meta-row">
            <span class="meta-label">指令</span>
            <span class="meta-value mono">{{ agentSystemPrompt(agent) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="configuredAgents.length > 0" class="agent-list">
      <div
        v-for="agent in configuredAgents"
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
              <span class="status-dot status-idle" />
              待命中
            </span>
          </div>
        </div>

        <div v-if="agent.description" class="agent-desc">
          {{ agent.description }}
        </div>

        <div class="agent-meta">
          <div class="meta-row">
            <span class="meta-label">模型</span>
            <span class="meta-value">{{ agent.model.provider }}/{{ agent.model.modelId }}</span>
          </div>
          <div v-if="agent.systemPrompt" class="meta-row">
            <span class="meta-label">指令</span>
            <span class="meta-value mono">{{ agent.systemPrompt.split('\n').filter(Boolean)[0] ?? '' }}</span>
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
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
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
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
}

.swarm-badge {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-accent-bg);
  color: var(--color-accent-light);
  flex-shrink: 0;
}

.swarm-name {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
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
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  transition: all 0.2s;
}

.agent-card:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: var(--border-default);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
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
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.agent-name {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.agent-status-text {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.status-idle {
  background: var(--text-muted);
}

.agent-desc {
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--text-muted);
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
  font-size: var(--text-sm);
  min-width: 0;
}

.meta-label {
  color: var(--text-muted);
  flex-shrink: 0;
  margin-right: 8px;
}

.meta-value {
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-value.mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.no-agents {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 16px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.no-agents p {
  margin: 0 0 4px;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
}

.no-agents span {
  font-size: var(--text-sm);
}


</style>
