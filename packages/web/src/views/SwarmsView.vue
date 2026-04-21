<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import SwarmCard from "../components/swarm/SwarmCard.vue";
import CreateSwarmDialog from "../components/swarm/CreateSwarmDialog.vue";
import type { SwarmConfig } from "../types/index.js";

const swarmStore = useSwarmStore();
const showDialog = ref(false);

onMounted(() => {
  swarmStore.fetchSwarms();
});

async function handleCreate(swarm: SwarmConfig) {
  await swarmStore.createSwarm(swarm);
  showDialog.value = false;
}
</script>

<template>
  <div class="swarms-view page-container">
    <div class="swarms-header">
      <div>
        <h2 class="section-title">Swarm 管理</h2>
        <p class="section-desc">管理和配置多 Agent 协作集群</p>
      </div>
      <button class="btn-primary" @click="showDialog = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        创建 Swarm
      </button>
    </div>

    <div class="swarms-grid">
      <SwarmCard
        v-for="swarm in swarmStore.swarms"
        :key="swarm.id"
        :swarm="swarm"
        @click="swarmStore.selectSwarm(swarm)"
      />
      <div v-if="swarmStore.swarms.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <p class="empty-title">暂无 Swarm 配置</p>
        <p class="empty-desc">点击上方按钮创建你的第一个 Swarm</p>
      </div>
    </div>

    <CreateSwarmDialog
      v-if="showDialog"
      @create="handleCreate"
      @close="showDialog = false"
    />
  </div>
</template>

<style scoped>
.swarms-view {
  height: 100%;
  overflow-y: auto;
}

.swarms-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin: 4px 0 0;
}

.swarms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
}

.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 0;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 16px;
}

.empty-icon svg {
  width: 28px;
  height: 28px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: 14px;
  margin: 0;
}
</style>
