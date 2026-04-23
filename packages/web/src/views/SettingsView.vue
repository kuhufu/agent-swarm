<script setup lang="ts">
import { onMounted, ref, reactive, computed } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { useSettingsStore } from "../stores/settings.js";
import type { InterventionPoint, InterventionStrategy, ApiProtocol, ProviderConfig, SavedModel, ModelInfo } from "../types/index.js";
import * as configApi from "../api/config.js";
import ProvidersTab from "../components/settings/ProvidersTab.vue";
import ModelsTab from "../components/settings/ModelsTab.vue";
import InterventionTab from "../components/settings/InterventionTab.vue";

const settingsStore = useSettingsStore();
const activeTab = ref<"providers" | "models" | "intervention">("providers");

interface ProviderEntry {
  apiKey: string;
  baseUrl: string;
  apiProtocol: ApiProtocol | "";
  enableThinkingCompat: boolean;
}

const providers = reactive<Record<string, ProviderEntry>>({});

const newProviderId = ref("");

function addCustomProvider() {
  const id = newProviderId.value.trim().toLowerCase();
  if (!id || providers[id]) return;
  providers[id] = {
    apiKey: "",
    baseUrl: "",
    apiProtocol: "openai-completions",
    enableThinkingCompat: false,
  };
  newProviderId.value = "";
}

function removeProvider(id: string) {
  delete providers[id];
}

function updateProvider(id: string, field: string, value: unknown) {
  const entry = providers[id];
  if (!entry) return;
  if (field === "apiKey") entry.apiKey = value as string;
  else if (field === "baseUrl") entry.baseUrl = value as string;
  else if (field === "apiProtocol") entry.apiProtocol = value as ApiProtocol | "";
  else if (field === "enableThinkingCompat") entry.enableThinkingCompat = value as boolean;
}

const models = reactive<SavedModel[]>([]);

function addModel(model: SavedModel) {
  models.push(model);
}

function removeModel(index: number) {
  models.splice(index, 1);
}

const providerIds = computed(() => Object.keys(providers));

const interventions = reactive<Partial<Record<InterventionPoint, InterventionStrategy>>>({
  before_agent_start: "auto",
  after_agent_end: "auto",
  before_tool_call: "auto",
  after_tool_call: "auto",
  on_handoff: "auto",
  on_error: "auto",
  on_approval_required: "confirm",
});

function updateIntervention(point: InterventionPoint, strategy: InterventionStrategy) {
  interventions[point] = strategy;
}

const saving = ref(false);
const saved = ref(false);
const saveError = ref("");
const loadError = ref("");

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "未知错误";
}

onMounted(async () => {
  try {
    await settingsStore.fetchConfig();
    loadError.value = "";
    const config = settingsStore.config;
    if (config) {
      for (const [provider, key] of Object.entries(config.apiKeys)) {
        if (!providers[provider]) {
          providers[provider] = {
            apiKey: "",
            baseUrl: "",
            apiProtocol: "openai-completions",
            enableThinkingCompat: false,
          };
        }
        if (key) providers[provider].apiKey = key;
      }
      if (config.providers) {
        for (const [id, pc] of Object.entries(config.providers)) {
          if (!providers[id]) {
            providers[id] = {
              apiKey: "",
              baseUrl: "",
              apiProtocol: "openai-completions",
              enableThinkingCompat: false,
            };
          }
          providers[id].baseUrl = pc.baseUrl ?? "";
          providers[id].apiProtocol = pc.apiProtocol ?? "";
          providers[id].enableThinkingCompat = pc.enable_thinking === true;
        }
      }
      if (config.models) {
        models.push(...config.models);
      }
    }
  } catch (error) {
    loadError.value = getErrorMessage(error);
  }
});

async function saveSettings() {
  saving.value = true;
  saved.value = false;
  saveError.value = "";
  try {
    const apiKeys: Record<string, string> = {};
    const providerConfigs: Record<string, ProviderConfig> = {};
    for (const [id, entry] of Object.entries(providers)) {
      if (entry.apiKey.trim()) apiKeys[id] = entry.apiKey;
      if (entry.baseUrl.trim() || entry.apiProtocol || entry.enableThinkingCompat) {
        providerConfigs[id] = {
          ...(entry.baseUrl.trim() ? { baseUrl: entry.baseUrl.trim() } : {}),
          ...(entry.apiProtocol ? { apiProtocol: entry.apiProtocol as ApiProtocol } : {}),
          ...(entry.enableThinkingCompat ? { enable_thinking: true } : {}),
        };
      }
    }
    await settingsStore.updateConfig({
      apiKeys,
      providers: providerConfigs,
      models: [...models],
    } as any);
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } catch (error) {
    saveError.value = getErrorMessage(error);
    MessagePlugin.error(`保存失败：${saveError.value}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-view">
    <div class="settings-layout">
      <aside class="settings-sidebar">
        <div class="sidebar-header">
          <h2>设置</h2>
          <p>配置 LLM 和全局策略</p>
          <p v-if="loadError" style="margin-top: 8px; color: #f87171; font-size: 12px;">加载失败：{{ loadError }}</p>
          <p v-if="saveError" style="margin-top: 8px; color: #f87171; font-size: 12px;">保存失败：{{ saveError }}</p>
        </div>
        <nav class="settings-nav">
          <button
            class="nav-item"
            :class="{ active: activeTab === 'providers' }"
            @click="activeTab = 'providers'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <div>
              <span class="nav-label">提供商配置</span>
              <span class="nav-desc">API Key 和端点</span>
            </div>
          </button>
          <button
            class="nav-item"
            :class="{ active: activeTab === 'models' }"
            @click="activeTab = 'models'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <div>
              <span class="nav-label">模型管理</span>
              <span class="nav-desc">自定义模型列表</span>
            </div>
          </button>
          <button
            class="nav-item"
            :class="{ active: activeTab === 'intervention' }"
            @click="activeTab = 'intervention'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <span class="nav-label">介入策略</span>
              <span class="nav-desc">全局审批规则</span>
            </div>
          </button>
        </nav>

        <div class="sidebar-footer">
          <button
            class="btn-primary save-btn"
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
      </aside>

      <main class="settings-content">
        <div v-if="activeTab === 'providers'" class="tab-panel">
          <ProvidersTab
            :providers="providers"
            @remove="removeProvider"
            @update="updateProvider"
          />
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

        <div v-if="activeTab === 'models'" class="tab-panel">
          <ModelsTab
            :models="models"
            :provider-ids="providerIds"
            @add="addModel"
            @remove="removeModel"
          />
        </div>

        <div v-if="activeTab === 'intervention'" class="tab-panel">
          <InterventionTab
            :interventions="interventions"
            @update="updateIntervention"
          />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow: hidden;
}

.settings-layout {
  display: flex;
  height: 100%;
}

.settings-sidebar {
  width: 280px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 24px 16px;
}

.sidebar-header {
  margin-bottom: 20px;
  padding: 0 8px;
}

.sidebar-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.sidebar-header p {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.settings-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.nav-item svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-label {
  font-weight: 600;
  font-size: 14px;
}

.nav-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}

.nav-item.active .nav-desc {
  color: rgba(129, 140, 248, 0.7);
}

.sidebar-footer {
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

.save-btn {
  width: 100%;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

.tab-panel {
  max-width: 720px;
}

.add-provider {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 16px;
}
</style>
