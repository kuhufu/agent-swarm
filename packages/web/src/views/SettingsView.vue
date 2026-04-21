<script setup lang="ts">
import { onMounted, ref, reactive, computed } from "vue";
import { useSettingsStore } from "../stores/settings.js";
import type { InterventionPoint, InterventionStrategy, ApiProtocol, ProviderConfig } from "../types/index.js";

const settingsStore = useSettingsStore();

// ── Provider management ──

const API_PROTOCOLS: { value: ApiProtocol; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "mistral-conversations", label: "Mistral Conversations" },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
];

interface ProviderEntry {
  apiKey: string;
  baseUrl: string;
  apiProtocol: ApiProtocol | "";
}

const providers = reactive<Record<string, ProviderEntry>>({});

const providerList = computed(() => {
  return Object.keys(providers).map(id => ({
    id,
    label: id,
    defaultProtocol: "openai-completions" as ApiProtocol,
    custom: true,
  }));
});

const newProviderId = ref("");

function addCustomProvider() {
  const id = newProviderId.value.trim().toLowerCase();
  if (!id || providers[id]) return;
  providers[id] = { apiKey: "", baseUrl: "", apiProtocol: "openai-completions" };
  newProviderId.value = "";
}

function removeProvider(id: string) {
  delete providers[id];
  // If the removed provider was the default, reset default
  if (defaultProvider.value === id) {
    defaultProvider.value = Object.keys(providers)[0] ?? "";
  }
}

function getEffectiveProtocol(id: string): ApiProtocol {
  const entry = providers[id];
  if (entry?.apiProtocol) return entry.apiProtocol;
  return "openai-completions";
}

// ── Default model ──

const defaultProvider = ref("anthropic");
const defaultModel = ref("claude-sonnet-4-20250514");

// ── Intervention ──

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
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      if (!providers[provider]) {
        providers[provider] = { apiKey: "", baseUrl: "", apiProtocol: "openai-completions" };
      }
      if (key) providers[provider].apiKey = key;
    }
    if (config.providers) {
      for (const [id, pc] of Object.entries(config.providers)) {
        if (!providers[id]) {
          providers[id] = { apiKey: "", baseUrl: "", apiProtocol: "openai-completions" };
        }
        providers[id].baseUrl = pc.baseUrl ?? "";
        providers[id].apiProtocol = pc.apiProtocol ?? "";
      }
    }
  }
});

async function saveSettings() {
  saving.value = true;
  saved.value = false;
  try {
    const apiKeys: Record<string, string> = {};
    const providerConfigs: Record<string, ProviderConfig> = {};
    for (const [id, entry] of Object.entries(providers)) {
      if (entry.apiKey.trim()) apiKeys[id] = entry.apiKey;
      if (entry.baseUrl.trim() || entry.apiProtocol) {
        providerConfigs[id] = {
          ...(entry.baseUrl.trim() ? { baseUrl: entry.baseUrl.trim() } : {}),
          ...(entry.apiProtocol ? { apiProtocol: entry.apiProtocol as ApiProtocol } : {}),
        };
      }
    }
    await settingsStore.updateConfig({
      defaultProvider: defaultProvider.value,
      defaultModel: defaultModel.value,
      apiKeys,
      providers: providerConfigs,
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

    <!-- ── Provider Configuration ── -->
    <div class="settings-section">
      <h3>LLM 提供商配置</h3>
      <p class="hint">为每个提供商配置 API Key、自定义 Base URL 和 API 协议。Base URL 留空则使用默认值。</p>
      <div class="provider-list">
        <div v-for="p in providerList" :key="p.id" class="provider-card">
          <div class="provider-header">
            <h4>{{ p.id }}</h4>
            <t-button variant="text" size="small" theme="danger" @click="removeProvider(p.id)">
              删除
            </t-button>
          </div>

          <div class="provider-fields">
            <div class="field-row">
              <label>API Key</label>
              <t-input
                v-model="providers[p.id].apiKey"
                placeholder="sk-..."
                type="password"
              />
            </div>
            <div class="field-row">
              <label>Base URL</label>
              <t-input
                v-model="providers[p.id].baseUrl"
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div class="field-row">
              <label>API 协议</label>
              <t-select
                v-model="providers[p.id].apiProtocol"
                :placeholder="getEffectiveProtocol(p.id)"
                clearable
              >
                <t-option
                  v-for="proto in API_PROTOCOLS"
                  :key="proto.value"
                  :value="proto.value"
                  :label="proto.label"
                />
              </t-select>
            </div>
          </div>
        </div>
      </div>

      <!-- Add custom provider -->
      <div class="add-provider">
        <t-input
          v-model="newProviderId"
          placeholder="自定义提供商 ID"
          size="small"
          style="width: 200px"
          @enter="addCustomProvider"
        />
        <t-button size="small" @click="addCustomProvider">添加提供商</t-button>
      </div>
    </div>

    <!-- ── Default Model ── -->
    <div class="settings-section">
      <h3>默认模型</h3>
      <div class="model-config">
        <div class="form-row">
          <label>提供商</label>
          <t-select v-model="defaultProvider">
            <t-option
              v-for="p in providerList"
              :key="p.id"
              :value="p.id"
              :label="p.id"
            />
          </t-select>
        </div>
        <div class="form-row">
          <label>模型 ID</label>
          <t-input v-model="defaultModel" placeholder="模型名称" />
        </div>
      </div>
    </div>

    <!-- ── Intervention Strategy ── -->
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
  margin: 0 0 8px 0;
}

.hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 16px 0;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.provider-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.provider-header h4 {
  color: #b0b0b0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.provider-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-row label {
  color: #999;
  min-width: 70px;
  font-size: 13px;
  flex-shrink: 0;
}

.field-row :deep(.t-input),
.field-row :deep(.t-select) {
  flex: 1;
}

.add-provider {
  display: flex;
  gap: 8px;
  align-items: center;
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
