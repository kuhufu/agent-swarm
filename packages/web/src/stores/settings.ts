import { defineStore } from "pinia";
import { ref } from "vue";
import type { LLMConfig, SavedModel } from "../types/index.js";
import * as configApi from "../api/config.js";
import { CACHE_KEYS } from "../utils/cache-keys.js";

const CACHED_MODELS_KEY = CACHE_KEYS.MODELS;

function restoreCachedModels(): SavedModel[] {
  try {
    const raw = localStorage.getItem(CACHED_MODELS_KEY);
    return raw ? (JSON.parse(raw) as SavedModel[]) : [];
  } catch {
    localStorage.removeItem(CACHED_MODELS_KEY);
    return [];
  }
}

function saveCachedModels(models: SavedModel[]) {
  localStorage.setItem(CACHED_MODELS_KEY, JSON.stringify(models));
}

export const useSettingsStore = defineStore("settings", () => {
  const config = ref<LLMConfig | null>(null);
  const models = ref<SavedModel[]>(restoreCachedModels());
  const loading = ref(false);

  async function fetchConfig() {
    loading.value = true;
    try {
      const res = await configApi.getConfig();
      config.value = res.data;
      if (Array.isArray(res.data.models)) {
        models.value = res.data.models;
        saveCachedModels(res.data.models);
      }
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(newConfig: Partial<LLMConfig>) {
    loading.value = true;
    try {
      const res = await configApi.updateConfig(newConfig);
      config.value = res.data;
      if (Array.isArray(res.data.models)) {
        models.value = res.data.models;
        saveCachedModels(res.data.models);
      }
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    config.value = null;
    models.value = [];
    loading.value = false;
  }

  return { config, models, loading, fetchConfig, updateConfig, reset };
});
