<script setup lang="ts">
import type { SwarmConfig } from "../../types/index.js";

defineProps<{
  swarm: SwarmConfig | null;
}>();
</script>

<template>
  <div class="agent-status">
    <h3>Agent 状态</h3>
    <div v-if="swarm" class="agent-list">
      <div v-for="agent in swarm.agents" :key="agent.id" class="agent-item">
        <span class="agent-dot idle" />
        <span class="agent-name">{{ agent.name }}</span>
        <span class="agent-mode">空闲</span>
      </div>
    </div>
    <div v-else class="no-swarm">
      <p>请选择一个 Swarm</p>
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

.no-swarm {
  text-align: center;
  padding: 24px 0;
  color: #666;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
