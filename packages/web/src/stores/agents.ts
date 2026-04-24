import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PresetAgent } from "../types/index.js";
import * as agentsApi from "../api/agents.js";
import type { CreatePresetAgentPayload, UpdatePresetAgentPayload } from "../api/agents.js";

function sortPresetAgents(input: PresetAgent[]): PresetAgent[] {
  return [...input].sort((a, b) => {
    if (a.builtIn !== b.builtIn) {
      return a.builtIn ? -1 : 1;
    }
    const categoryCompare = a.category.localeCompare(b.category, "zh-CN");
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    const nameCompare = a.name.localeCompare(b.name, "zh-CN");
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return a.id.localeCompare(b.id);
  });
}

export const useAgentStore = defineStore("agents", () => {
  const presets = ref<PresetAgent[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  const sortedPresets = computed(() => sortPresetAgents(presets.value));
  const builtInPresets = computed(() => sortedPresets.value.filter((item) => item.builtIn));
  const customPresets = computed(() => sortedPresets.value.filter((item) => !item.builtIn));

  function upsertPreset(next: PresetAgent) {
    const index = presets.value.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      presets.value[index] = next;
      presets.value = [...presets.value];
      return;
    }
    presets.value = [...presets.value, next];
  }

  async function fetchAgents(force = false) {
    if (loading.value) {
      return;
    }
    if (loaded.value && !force) {
      return;
    }

    loading.value = true;
    try {
      const res = await agentsApi.listAgents();
      presets.value = sortPresetAgents(Array.isArray(res.data) ? res.data : []);
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function createAgent(payload: CreatePresetAgentPayload) {
    const res = await agentsApi.createAgent(payload);
    upsertPreset(res.data);
    return res.data;
  }

  async function updateAgent(id: string, payload: UpdatePresetAgentPayload) {
    const res = await agentsApi.updateAgent(id, payload);
    upsertPreset(res.data);
    return res.data;
  }

  async function deleteAgent(id: string) {
    await agentsApi.deleteAgent(id);
    presets.value = presets.value.filter((item) => item.id !== id);
  }

  return {
    presets,
    loading,
    loaded,
    sortedPresets,
    builtInPresets,
    customPresets,
    fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent,
  };
});
