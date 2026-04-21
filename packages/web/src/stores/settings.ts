import { defineStore } from "pinia";
import { ref } from "vue";
import type { LLMConfig } from "../types/index.js";
import * as configApi from "../api/config.js";

export const useSettingsStore = defineStore("settings", () => {
  const config = ref<LLMConfig | null>(null);
  const loading = ref(false);

  async function fetchConfig() {
    loading.value = true;
    try {
      const res = await configApi.getConfig();
      config.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(newConfig: Partial<LLMConfig>) {
    loading.value = true;
    try {
      const res = await configApi.updateConfig(newConfig);
      config.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  return { config, loading, fetchConfig, updateConfig };
});
