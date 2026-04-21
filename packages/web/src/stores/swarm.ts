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

  function selectSwarm(swarm: SwarmConfig) {
    currentSwarm.value = swarm;
  }

  return { swarms, currentSwarm, loading, fetchSwarms, selectSwarm };
});
