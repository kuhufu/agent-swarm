<script setup lang="ts">
import { onMounted } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import SwarmCard from "../components/swarm/SwarmCard.vue";

const swarmStore = useSwarmStore();

onMounted(() => {
  swarmStore.fetchSwarms();
});
</script>

<template>
  <div class="swarms-view">
    <div class="swarms-header">
      <h2>Swarm 管理</h2>
      <t-button theme="primary">创建 Swarm</t-button>
    </div>
    <div class="swarms-grid">
      <SwarmCard
        v-for="swarm in swarmStore.swarms"
        :key="swarm.id"
        :swarm="swarm"
        @click="swarmStore.selectSwarm(swarm)"
      />
      <div v-if="swarmStore.swarms.length === 0" class="empty-state">
        <p>暂无 Swarm 配置，点击上方按钮创建</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.swarms-view {
  padding: 24px;
}

.swarms-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.swarms-header h2 {
  color: #e0e0e0;
  margin: 0;
}

.swarms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 64px 0;
  color: #888;
}
</style>
