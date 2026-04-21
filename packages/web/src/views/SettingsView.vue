<script setup lang="ts">
import { onMounted } from "vue";
import { useSettingsStore } from "../stores/settings.js";

const settingsStore = useSettingsStore();

onMounted(() => {
  settingsStore.fetchConfig();
});
</script>

<template>
  <div class="settings-view">
    <h2>设置</h2>

    <div class="settings-section">
      <h3>LLM 提供商配置</h3>
      <div class="provider-cards">
        <div class="provider-card">
          <h4>Anthropic</h4>
          <t-input placeholder="API Key" type="password" />
        </div>
        <div class="provider-card">
          <h4>OpenAI</h4>
          <t-input placeholder="API Key" type="password" />
        </div>
        <div class="provider-card">
          <h4>Google</h4>
          <t-input placeholder="API Key" type="password" />
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>默认模型</h3>
      <t-select placeholder="选择默认提供商" />
    </div>

    <div class="settings-section">
      <h3>全局介入策略</h3>
      <p class="hint">配置各介入点的默认策略</p>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 800px;
}

.settings-view h2 {
  color: #e0e0e0;
  margin-bottom: 24px;
}

.settings-section {
  margin-bottom: 32px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.settings-section h3 {
  color: #c0c0c0;
  margin: 0 0 16px 0;
}

.provider-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.provider-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.provider-card h4 {
  color: #b0b0b0;
  margin: 0 0 8px 0;
}

.hint {
  color: #888;
  font-size: 14px;
}
</style>
