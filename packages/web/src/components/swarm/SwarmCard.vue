<script setup lang="ts">
import type { SwarmConfig } from "../../types/index.js";

defineProps<{
  swarm: SwarmConfig;
}>();

const modeIcons: Record<string, string> = {
  router: "🔀",
  sequential: "➡️",
  parallel: "⏩",
  swarm: "🐝",
  debate: "⚖️",
};
</script>

<template>
  <div class="swarm-card">
    <div class="card-header">
      <span class="mode-icon">{{ modeIcons[swarm.mode] ?? "📦" }}</span>
      <h3>{{ swarm.name }}</h3>
    </div>
    <div class="card-body">
      <div class="card-meta">
        <span>模式: {{ swarm.mode }}</span>
        <span>Agent: {{ swarm.agents.length }}</span>
      </div>
      <div class="agent-tags">
        <span v-for="agent in swarm.agents" :key="agent.id" class="agent-tag">
          {{ agent.name }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.swarm-card {
  padding: 20px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.swarm-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.3);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.mode-icon {
  font-size: 24px;
}

.card-header h3 {
  margin: 0;
  color: #e0e0e0;
  font-size: 16px;
}

.card-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
  color: #888;
  font-size: 13px;
}

.agent-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-tag {
  padding: 2px 10px;
  background: rgba(99, 102, 241, 0.1);
  border-radius: 10px;
  font-size: 12px;
  color: #a5b4fc;
}
</style>
