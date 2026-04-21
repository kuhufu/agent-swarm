<script setup lang="ts">
import { onMounted, ref, reactive, computed } from "vue";
import { useSettingsStore } from "../stores/settings.js";
import type { InterventionPoint, InterventionStrategy, ApiProtocol, ProviderConfig } from "../types/index.js";

const settingsStore = useSettingsStore();

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
  if (defaultProvider.value === id) {
    defaultProvider.value = Object.keys(providers)[0] ?? "";
  }
}

function getEffectiveProtocol(id: string): ApiProtocol {
  const entry = providers[id];
  if (entry?.apiProtocol) return entry.apiProtocol;
  return "openai-completions";
}

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

const strategyOptions: { value: InterventionStrategy; label: string; color: string }[] = [
  { value: "auto", label: "自动批准", color: "#22c55e" },
  { value: "confirm", label: "确认", color: "#6366f1" },
  { value: "review", label: "审查", color: "#f59e0b" },
  { value: "edit", label: "编辑", color: "#3b82f6" },
  { value: "reject", label: "拒绝", color: "#ef4444" },
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
  <div class="settings-view page-container">
    <div class="settings-header">
      <div>
        <h2 class="section-title">设置</h2>
        <p class="section-desc">配置 LLM 提供商和全局介入策略</p>
      </div>
      <button
        class="btn-primary"
        :disabled="saving"
        @click="saveSettings"
      >
        <svg v-if="!saved" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {{ saved ? "已保存" : "保存设置" }}
      </button>
    </div>

    <!-- Provider Configuration -->
    <div class="settings-section">
      <div class="section-header">
        <div>
          <h3>LLM 提供商配置</h3>
          <p class="section-hint">为每个提供商配置 API Key、自定义 Base URL 和 API 协议</p>
        </div>
      </div>

      <div class="provider-list">
        <div v-for="p in providerList" :key="p.id" class="provider-card card">
          <div class="provider-header">
            <div class="provider-title">
              <div class="provider-avatar">{{ p.id.charAt(0).toUpperCase() }}</div>
              <span class="provider-name">{{ p.id }}</span>
            </div>
            <button class="remove-btn" @click="removeProvider(p.id)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="provider-fields">
            <div class="field-row">
              <label>API Key</label>
              <input
                v-model="providers[p.id].apiKey"
                class="input-field"
                placeholder="sk-..."
                type="password"
              />
            </div>
            <div class="field-row">
              <label>Base URL</label>
              <input
                v-model="providers[p.id].baseUrl"
                class="input-field"
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div class="field-row">
              <label>API 协议</label>
              <select v-model="providers[p.id].apiProtocol" class="input-field">
                <option value="">默认 ({{ getEffectiveProtocol(p.id) }})</option>
                <option v-for="proto in API_PROTOCOLS" :key="proto.value" :value="proto.value">
                  {{ proto.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="add-provider">
        <input
          v-model="newProviderId"
          class="input-field"
          placeholder="自定义提供商 ID"
          style="width: 200px;"
          @keyup.enter="addCustomProvider"
        />
        <button class="btn-secondary" @click="addCustomProvider">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          添加
        </button>
      </div>
    </div>

    <!-- Default Model -->
    <div class="settings-section">
      <h3>默认模型</h3>
      <div class="model-config">
        <div class="field-row">
          <label>提供商</label>
          <select v-model="defaultProvider" class="input-field">
            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.id }}</option>
          </select>
        </div>
        <div class="field-row">
          <label>模型 ID</label>
          <input v-model="defaultModel" class="input-field" placeholder="模型名称" />
        </div>
      </div>
    </div>

    <!-- Intervention Strategy -->
    <div class="settings-section">
      <h3>全局介入策略</h3>
      <p class="section-hint">配置各介入点的默认策略</p>
      <div class="intervention-list">
        <div v-for="point in interventionPoints" :key="point.key" class="intervention-row">
          <span class="intervention-label">{{ point.label }}</span>
          <div class="strategy-options">
            <button
              v-for="opt in strategyOptions"
              :key="opt.value"
              class="strategy-btn"
              :class="{ active: interventions[point.key] === opt.value }"
              :style="interventions[point.key] === opt.value ? { background: opt.color + '20', color: opt.color, borderColor: opt.color + '40' } : {}"
              @click="interventions[point.key] = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin: 4px 0 0;
}

.settings-section {
  margin-bottom: 28px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
}

.settings-section h3 {
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
}

.section-hint {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0 0 20px;
}

.section-header {
  margin-bottom: 20px;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.provider-card {
  padding: 20px;
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.provider-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-avatar {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent-light);
}

.provider-name {
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 600;
}

.remove-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.remove-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger);
}

.provider-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.field-row label {
  color: var(--color-text-muted);
  min-width: 70px;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.field-row input,
.field-row select {
  flex: 1;
}

.add-provider {
  display: flex;
  gap: 10px;
  align-items: center;
}

.model-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 500px;
}

.intervention-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.intervention-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.intervention-label {
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.strategy-options {
  display: flex;
  gap: 6px;
}

.strategy-btn {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.strategy-btn.active {
  border-width: 1px;
}
</style>
