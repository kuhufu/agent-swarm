<script setup lang="ts">
import { onMounted, ref, reactive, computed } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { useSettingsStore } from "../stores/settings.js";
import type { InterventionPoint, InterventionStrategy, ApiProtocol, ProviderConfig, SavedModel } from "../types/index.js";
import ProvidersTab from "../components/settings/ProvidersTab.vue";
import ModelsTab from "../components/settings/ModelsTab.vue";
import InterventionTab from "../components/settings/InterventionTab.vue";

const settingsStore = useSettingsStore();
type SettingsTab = "providers" | "models" | "intervention";

const activeTab = ref<SettingsTab>("providers");
const activeTabMeta = computed(() => {
  const tabMeta: Record<SettingsTab, { title: string; description: string }> = {
    providers: {
      title: "提供商配置",
      description: "管理 API Key、Base URL 与协议策略",
    },
    models: {
      title: "模型管理",
      description: "维护可在 Swarm/Agent 中复用的模型列表",
    },
    intervention: {
      title: "介入策略",
      description: "设置全局审批与介入默认行为",
    },
  };
  return tabMeta[activeTab.value];
});

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
          <h2>设置管理</h2>
          <p>配置 LLM 和全局策略</p>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">配置项</div>
          <nav class="settings-nav">
            <button
              class="settings-item"
              :class="{ active: activeTab === 'providers' }"
              @click="activeTab = 'providers'"
            >
              <div class="settings-item-top">
                <span class="settings-nav-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </span>
                <span class="settings-name">提供商配置</span>
              </div>
              <span class="settings-meta">API Key 和端点</span>
            </button>
            <button
              class="settings-item"
              :class="{ active: activeTab === 'models' }"
              @click="activeTab = 'models'"
            >
              <div class="settings-item-top">
                <span class="settings-nav-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </span>
                <span class="settings-name">模型管理</span>
              </div>
              <span class="settings-meta">自定义模型列表</span>
            </button>
            <button
              class="settings-item"
              :class="{ active: activeTab === 'intervention' }"
              @click="activeTab = 'intervention'"
            >
              <div class="settings-item-top">
                <span class="settings-nav-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <span class="settings-name">介入策略</span>
              </div>
              <span class="settings-meta">全局审批规则</span>
            </button>
          </nav>
        </div>

        <div v-if="loadError || saveError" class="sidebar-status">
          <p v-if="loadError">加载失败：{{ loadError }}</p>
          <p v-if="saveError">保存失败：{{ saveError }}</p>
        </div>
      </aside>

      <main class="settings-content">
        <div class="detail-card">
          <div class="detail-header">
            <div>
              <h3>{{ activeTabMeta.title }}</h3>
              <p class="detail-hint">{{ activeTabMeta.description }}</p>
            </div>
            <button
              class="btn-primary"
              :disabled="saving"
              @click="saveSettings"
            >
              <svg v-if="!saved" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {{ saved ? "已保存" : "保存设置" }}
            </button>
          </div>

          <div v-if="activeTab === 'providers'" class="tab-panel">
            <ProvidersTab
              :providers="providers"
              @remove="removeProvider"
              @update="updateProvider"
            />
            <div class="add-provider">
              <input
                v-model="newProviderId"
                class="input-field add-provider-input"
                placeholder="自定义提供商 ID"
                @keyup.enter="addCustomProvider"
              />
              <button class="btn-secondary compact-btn" @click="addCustomProvider">
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
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
}

.settings-layout {
  display: flex;
  height: 100%;
}

.settings-sidebar {
  width: 280px;
  border-right: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-header h2 {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.sidebar-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.settings-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.settings-section-title {
  margin-top: 6px;
  padding: 0 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}

.settings-item {
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-item:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.05);
}

.settings-item.active {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.settings-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.settings-nav-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.settings-nav-icon svg {
  width: 18px;
  height: 18px;
}

.settings-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}

.settings-item.active .settings-meta {
  color: rgba(129, 140, 248, 0.8);
}

.sidebar-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.1);
}

.sidebar-status p {
  margin: 0;
  color: #fca5a5;
  font-size: 12px;
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px;
}

.detail-card {
  max-width: 960px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  padding: 20px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 16px;
}

.detail-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.detail-hint {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.tab-panel {
  max-width: 100%;
}

.tab-panel :deep(.content-header) {
  display: none;
}

.add-provider {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 14px;
}

.add-provider-input {
  width: 220px;
  max-width: 100%;
}

.compact-btn {
  padding: 6px 12px;
  font-size: 13px;
}

@media (max-width: 1024px) {
  .settings-layout {
    flex-direction: column;
  }

  .settings-sidebar {
    width: 100%;
    max-height: 280px;
    border-right: none;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .settings-content {
    padding: 16px;
  }

  .detail-header {
    flex-direction: column;
    align-items: stretch;
  }

  .add-provider {
    flex-wrap: wrap;
  }
}
</style>
