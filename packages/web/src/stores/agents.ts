import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PresetAgent } from "../types/index.js";
import * as agentsApi from "../api/agents.js";
import type { CreatePresetAgentPayload, UpdatePresetAgentPayload } from "../api/agents.js";

function sortByName(input: PresetAgent[]): PresetAgent[] {
  return [...input].sort((a, b) => {
    const cat = a.category.localeCompare(b.category, "zh-CN");
    if (cat !== 0) return cat;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

export const useAgentStore = defineStore("agents", () => {
  const presets = ref<PresetAgent[]>([]);
  const templates = ref<PresetAgent[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  const sortedPresets = computed(() => sortByName(presets.value));
  const sortedTemplates = computed(() => sortByName(templates.value));

  function upsertPreset(next: PresetAgent) {
    const index = presets.value.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      presets.value[index] = next;
      presets.value = [...presets.value];
      return;
    }
    presets.value = [...presets.value, next];
  }

  function upsertTemplate(next: PresetAgent) {
    const index = templates.value.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      templates.value[index] = next;
      templates.value = sortByName(templates.value);
      return;
    }
    templates.value = sortByName([...templates.value, next]);
  }

  async function fetchAgents(force = false) {
    if (loading.value) return;
    if (loaded.value && !force) return;

    loading.value = true;
    try {
      const res = await agentsApi.listAgents();
      const data = res.data as { presets: PresetAgent[]; templates: PresetAgent[] };
      presets.value = sortByName(Array.isArray(data.presets) ? data.presets : []);
      templates.value = sortByName(Array.isArray(data.templates) ? data.templates : []);
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

  async function importTemplate(templateId: string) {
    const res = await agentsApi.importTemplate(templateId);
    upsertPreset(res.data);
    return res.data;
  }

  async function fetchTemplates() {
    const res = await agentsApi.listTemplates();
    templates.value = sortByName(Array.isArray(res.data) ? res.data : []);
    return templates.value;
  }

  async function createTemplate(payload: CreatePresetAgentPayload) {
    const res = await agentsApi.createTemplate(payload);
    upsertTemplate(res.data);
    return res.data;
  }

  async function updateTemplate(id: string, payload: UpdatePresetAgentPayload) {
    const res = await agentsApi.updateTemplate(id, payload);
    upsertTemplate(res.data);
    return res.data;
  }

  async function deleteTemplate(id: string) {
    await agentsApi.deleteTemplate(id);
    templates.value = templates.value.filter((item) => item.id !== id);
  }

  return {
    presets,
    templates,
    sortedTemplates,
    loading,
    loaded,
    sortedPresets,
    fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    importTemplate,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
});
