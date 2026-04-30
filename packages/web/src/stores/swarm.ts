import { defineStore } from "pinia";
import { ref } from "vue";
import type { SwarmConfig } from "../types/index.js";
import * as swarmApi from "../api/swarms.js";

const SWARMS_CACHE_KEY = "cached-swarms";

export const useSwarmStore = defineStore("swarm", () => {
  const swarms = ref<SwarmConfig[]>(restoreSwarmCache());
  const currentSwarm = ref<SwarmConfig | null>(null);
  const loading = ref(false);

  function restoreSwarmCache(): SwarmConfig[] {
    try {
      const raw = localStorage.getItem(SWARMS_CACHE_KEY);
      return raw ? (JSON.parse(raw) as SwarmConfig[]) : [];
    } catch {
      localStorage.removeItem(SWARMS_CACHE_KEY);
      return [];
    }
  }

  function saveSwarmCache(swarmList: SwarmConfig[]) {
    localStorage.setItem(SWARMS_CACHE_KEY, JSON.stringify(swarmList));
  }

  async function fetchSwarms() {
    loading.value = true;
    try {
      const res = await swarmApi.listSwarms();
      swarms.value = res.data;
      saveSwarmCache(res.data);
      if (currentSwarm.value) {
        const updated = swarms.value.find((s) => s.id === currentSwarm.value!.id);
        if (updated) {
          currentSwarm.value = updated;
        } else {
          currentSwarm.value = null;
        }
      }
    } finally {
      loading.value = false;
    }
  }

  async function createSwarm(swarm: SwarmConfig) {
    const res = await swarmApi.createSwarm(swarm);
    swarms.value.push(res.data);
    saveSwarmCache(swarms.value);
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
    saveSwarmCache(swarms.value);
    return res.data;
  }

  async function removeSwarm(id: string) {
    await swarmApi.deleteSwarm(id);
    swarms.value = swarms.value.filter((s) => s.id !== id);
    saveSwarmCache(swarms.value);
    if (currentSwarm.value?.id === id) {
      currentSwarm.value = null;
    }
  }

  function selectSwarm(swarm: SwarmConfig) {
    currentSwarm.value = swarm;
  }

  function clearSwarmSelection() {
    currentSwarm.value = null;
  }

  function reset() {
    swarms.value = [];
    currentSwarm.value = null;
    loading.value = false;
  }

  return { swarms, currentSwarm, loading, fetchSwarms, createSwarm, updateSwarm, removeSwarm, selectSwarm, clearSwarmSelection, reset };
});
