<script setup lang="ts">
import type { SwarmConfig } from "../../types/index.js";

defineProps<{
  swarm: SwarmConfig;
}>();

const modeConfig: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  router: { icon: "🔀", label: "Router 路由", color: "#818cf8", bg: "rgba(99, 102, 241, 0.1)" },
  sequential: { icon: "➡️", label: "Sequential 顺序", color: "#34d399", bg: "rgba(52, 211, 153, 0.1)" },
  parallel: { icon: "⏩", label: "Parallel 并行", color: "#60a5fa", bg: "rgba(96, 165, 250, 0.1)" },
  swarm: { icon: "🐝", label: "Swarm 蜂群", color: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)" },
  debate: { icon: "⚖️", label: "Debate 辩论", color: "#f87171", bg: "rgba(248, 113, 113, 0.1)" },
};

function getModeConfig(mode: string) {
  return modeConfig[mode] ?? { icon: "📦", label: mode, color: "#9ca3af", bg: "rgba(255, 255, 255, 0.05)" };
}
</script>

<template>
  <div class="swarm-card card">
    <div class="card-header">
      <div class="mode-badge" :style="{ background: getModeConfig(swarm.mode).bg, color: getModeConfig(swarm.mode).color }">
        <span class="mode-icon">{{ getModeConfig(swarm.mode).icon }}</span>
        <span class="mode-label">{{ getModeConfig(swarm.mode).label }}</span>
      </div>
    </div>

    <h3 class="swarm-name">{{ swarm.name }}</h3>

    <div class="swarm-meta">
      <div class="meta-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>{{ swarm.agents.length }} 个 Agent</span>
      </div>
    </div>

    <div class="agent-tags">
      <span v-for="agent in swarm.agents" :key="agent.id" class="agent-tag">
        {{ agent.name }}
      </span>
    </div>

    <div class="card-footer">
      <span class="swarm-id">{{ swarm.id }}</span>
      <button class="action-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.swarm-card {
  padding: 20px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
}

.mode-icon {
  font-size: 14px;
}

.swarm-name {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.swarm-meta {
  display: flex;
  gap: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.agent-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-tag {
  padding: 4px 10px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 8px;
  font-size: 12px;
  color: var(--color-accent-light);
  font-weight: 500;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}

.swarm-id {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}
</style>
