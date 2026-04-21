<script setup lang="ts">
import { onMounted, ref, reactive } from "vue";
import { useSettingsStore } from "../stores/settings.js";
import type { InterventionPoint, InterventionStrategy } from "../types/index.js";

const settingsStore = useSettingsStore();

// Local form state
const apiKeys = reactive<Record<string, string>>({
  anthropic: "",
  openai: "",
  google: "",
});

const defaultProvider = ref("anthropic");
const defaultModel = ref("claude-sonnet-4-20250514");

const interventionPoints: { key: InterventionPoint; label: string }[] = [
  { key: "before_agent_start", label: "Agent 启动前" },
  { key: "after_agent_end", label: "Agent 结束后" },
  { key: "before_tool_call", label: "工具调用前" },
  { key: "after_tool_call", label: "工具调用后" },
  { key: "on_handoff", label: "Agent 交接时" },
  { key: "on_error", label: "发生错误时" },
  { key: "on_approval_required", label: "需要审批时" },
];

const strategyOptions: { value: InterventionStrategy; label: string }[] = [
  { value: "auto", label: "自动批准" },
  { value: "confirm", label: "确认" },
  { value: "review", label: "审查" },
  { value: "edit", label: "编辑" },
  { value: "reject", label: "拒绝" },
];

const interventions = reactive<Partial<Record<InterventionPoint, InterventionStrategy>>>({
  before_agent_start: "auto",
  after_agent_end: "auto",
  before_tool_call: "auto",
  after_tool_call: "auto",
  on_handoff: "auto",
  on_error: "auto",
  on_approval_required: "confirm",
});

const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  await settingsStore.fetchConfig();
  const config = settingsStore.config;
  if (config) {
    defaultProvider.value = config.defaultProvider;
    defaultModel.value = config.defaultModel;
    // Populate API keys (masked values from server)
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      if (key) apiKeys[provider] = key;
    }
  }
});

async function saveSettings() {
  saving.value = true;
  saved.value = false;
  try {
    await settingsStore.updateConfig({
      defaultProvider: defaultProvider.value,
      defaultModel: defaultModel.value,
      apiKeys: Object.fromEntries(
        Object.entries(apiKeys).filter(([, v]) => v.trim() !== ""),
      ),
    } as any);
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-view">
    <h2>设置</h2>

    <div class="settings-section">
      <h3>LLM 提供商配置</h3>
      <div class="provider-cards">
        <div v-for="(_, provider) in apiKeys" :key="provider" class="provider-card">
          <h4>{{ provider.charAt(0).toUpperCase() + provider.slice(1) }}</h4>
          <t-input
            v-model="apiKeys[provider]"
            placeholder="API Key"
            type="password"
          />
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>默认模型</h3>
      <div class="model-config">
        <div class="form-row">
          <label>提供商</label>
          <t-select v-model="defaultProvider">
            <t-option value="anthropic" label="Anthropic" />
            <t-option value="openai" label="OpenAI" />
            <t-option value="google" label="Google" />
            <t-option value="xai" label="xAI" />
            <t-option value="groq" label="Groq" />
            <t-option value="openrouter" label="OpenRouter" />
          </t-select>
        </div>
        <div class="form-row">
          <label>模型 ID</label>
          <t-input v-model="defaultModel" placeholder="模型名称" />
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>全局介入策略</h3>
      <p class="hint">配置各介入点的默认策略</p>
      <div class="intervention-grid">
        <div v-for="point in interventionPoints" :key="point.key" class="intervention-row">
          <span class="intervention-label">{{ point.label }}</span>
          <t-select
            v-model="interventions[point.key]"
            size="small"
          >
            <t-option
              v-for="opt in strategyOptions"
              :key="opt.value"
              :value="opt.value"
              :label="opt.label"
            />
          </t-select>
        </div>
      </div>
    </div>

    <div class="settings-actions">
      <t-button
        theme="primary"
        :loading="saving"
        @click="saveSettings"
      >
        {{ saved ? "已保存" : "保存设置" }}
      </t-button>
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

.model-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-row label {
  color: #999;
  min-width: 60px;
  font-size: 14px;
}

.hint {
  color: #888;
  font-size: 14px;
  margin-bottom: 16px;
}

.intervention-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.intervention-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.intervention-label {
  color: #c0c0c0;
  font-size: 14px;
}

.intervention-row :deep(.t-select) {
  width: 160px;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
