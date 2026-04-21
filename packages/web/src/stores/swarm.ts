import { defineStore } from "pinia";
import { ref } from "vue";
import type { SwarmConfig } from "../types/index.js";
import * as swarmApi from "../api/swarms.js";

export const useSwarmStore = defineStore("swarm", () => {
  const swarms = ref<SwarmConfig[]>([]);
  const currentSwarm = ref<SwarmConfig | null>(null);
  const loading = ref(false);

  async function fetchSwarms() {
    loading.value = true;
    try {
      const res = await swarmApi.listSwarms();
      swarms.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function createSwarm(swarm: SwarmConfig) {
    const res = await swarmApi.createSwarm(swarm);
    swarms.value.push(res.data);
    return res.data;
  }

  async function updateSwarm(id: string, swarm: SwarmConfig) {
    const res = await swarmApi.updateSwarm(id, swarm);
    const index = swarms.value.findIndex((s) => s.id === id);
    if (index >= 0) {
      swarms.value[index] = res.data;
    }
    if (currentSwarm.value?.id === id) {
      currentSwarm.value = res.data;
    }
    return res.data;
  }

  async function removeSwarm(id: string) {
    await swarmApi.deleteSwarm(id);
    swarms.value = swarms.value.filter((s) => s.id !== id);
    if (currentSwarm.value?.id === id) {
      currentSwarm.value = null;
    }
  }

  function selectSwarm(swarm: SwarmConfig) {
    currentSwarm.value = swarm;
  }

  return { swarms, currentSwarm, loading, fetchSwarms, createSwarm, updateSwarm, removeSwarm, selectSwarm };
});
