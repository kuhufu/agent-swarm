<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useChat, type DirectModelSelection } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import * as configApi from "../../api/config.js";
import type { SavedModel, ProviderInfo, ModelInfo } from "../../types/index.js";

const props = defineProps<{
  swarmId: string;
  active?: boolean;
  isDirectMode?: boolean;
}>();

const {
  inputText,
  sending,
  connected,
  connect,
  sendMessage,
  sendDirectMessage,
  abort,
  directModel,
  currentTimeToolEnabled,
  jsExecutionToolEnabled,
  thinkModeEnabled,
} = useChat();

const settingsStore = useSettingsStore();

// ── Model selector state ──
const selectedSavedModelId = ref<string>("");
const showMoreModels = ref(false);
const providerList = ref<ProviderInfo[]>([]);
const modelList = ref<ModelInfo[]>([]);
const loadingProviders = ref(false);
const loadingModels = ref(false);
const selectedProvider = ref("");
const selectedModelId = ref("");

const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);

const canSendDirect = computed(() =>
  directModel.value !== null && directModel.value.provider !== "" && directModel.value.modelId !== "",
);

function handleSend() {
  if (props.active) {
    abort();
  } else if (props.isDirectMode) {
    sendDirectMessage();
  } else {
    sendMessage(props.swarmId);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!props.active) {
      if (props.isDirectMode) {
        sendDirectMessage();
      } else {
        sendMessage(props.swarmId);
      }
    }
  }
}

// ── Saved model selection ──
function selectSavedModel(sm: SavedModel) {
  selectedSavedModelId.value = sm.id;
  directModel.value = { provider: sm.provider, modelId: sm.modelId };
  showMoreModels.value = false;
}

// ── Online model selection (for models not in saved list) ──
async function loadProviders() {
  loadingProviders.value = true;
  try {
    const res = await configApi.listProviders();
    providerList.value = res.data ?? [];
  } catch {
    providerList.value = [];
  } finally {
    loadingProviders.value = false;
  }
}

async function loadModels(providerId: string) {
  if (!providerId) {
    modelList.value = [];
    return;
  }
  loadingModels.value = true;
  try {
    const res = await configApi.listModels(providerId);
    modelList.value = res.data ?? [];
  } catch {
    modelList.value = [];
  } finally {
    loadingModels.value = false;
  }
}

function onProviderChange() {
  selectedModelId.value = "";
  directModel.value = null;
  loadModels(selectedProvider.value);
}

function selectOnlineModel(m: ModelInfo) {
  selectedSavedModelId.value = "";
  selectedModelId.value = m.id;
  directModel.value = { provider: selectedProvider.value, modelId: m.id };
  showMoreModels.value = false;
}

function applyManualModelId() {
  if (selectedProvider && selectedModelId) {
    directModel.value = { provider: selectedProvider.value, modelId: selectedModelId.value };
    selectedSavedModelId.value = "";
  }
}

// When entering direct mode, ensure settings are loaded
watch(() => props.isDirectMode, (isDirect) => {
  if (isDirect && !settingsStore.config) {
    settingsStore.fetchConfig();
  }
  if (isDirect && providerList.value.length === 0) {
    loadProviders();
  }
}, { immediate: true });

onMounted(() => {
  if (!connected.value) {
    connect();
  }
  if (props.isDirectMode) {
    settingsStore.fetchConfig();
    loadProviders();
  }
});
</script>

<template>
  <div class="chat-input">
    <!-- Direct mode: model selector -->
    <div v-if="isDirectMode" class="model-selector">
      <!-- Saved models as primary selection -->
      <div v-if="savedModels.length" class="model-chips">
        <button
          v-for="sm in savedModels"
          :key="sm.id"
          class="model-chip"
          :class="{ active: selectedSavedModelId === sm.id }"
          @click="selectSavedModel(sm)"
        >
          <span class="chip-provider">{{ sm.provider }}</span>
          <span class="chip-separator">/</span>
          <span class="chip-model">{{ sm.name }}</span>
        </button>
      </div>

      <!-- Toggle for more models -->
      <button class="more-models-btn" @click="showMoreModels = !showMoreModels">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {{ showMoreModels ? '收起' : '更多模型...' }}
      </button>

      <!-- Online model selection (expanded) -->
      <div v-if="showMoreModels" class="online-model-selector">
        <div class="provider-model-row">
          <select
            v-model="selectedProvider"
            class="input-field provider-select"
            @change="onProviderChange"
          >
            <option value="">选择提供商</option>
            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.id }}</option>
          </select>
          <div class="model-select-wrapper">
            <input
              v-model="selectedModelId"
              class="input-field model-input"
              placeholder="模型 ID"
              @change="applyManualModelId"
            />
          </div>
        </div>
        <div v-if="loadingModels" class="loading-hint">加载模型列表...</div>
        <div v-else-if="modelList.length > 0" class="online-model-list">
          <button
            v-for="m in modelList"
            :key="m.id"
            class="online-model-item"
            :class="{ active: directModel?.provider === selectedProvider && directModel?.modelId === m.id }"
            @click="selectOnlineModel(m)"
          >
            <span class="online-model-id">{{ m.id }}</span>
            <span class="online-model-meta">{{ (m.contextWindow / 1000).toFixed(0) }}k</span>
          </button>
        </div>
      </div>
    </div>

    <div class="tool-options">
      <label class="tool-toggle">
        <input v-model="currentTimeToolEnabled" type="checkbox">
        <span>当前时间工具</span>
      </label>
      <label class="tool-toggle">
        <input v-model="jsExecutionToolEnabled" type="checkbox">
        <span>前端 JS 执行工具</span>
      </label>
      <label class="tool-toggle">
        <input v-model="thinkModeEnabled" type="checkbox">
        <span>Think 模式</span>
      </label>
      <span class="tool-hint">工具默认关闭；Think 仅对支持 think/no_think 的模型生效</span>
    </div>
    <div class="input-wrapper">
      <div class="textarea-wrapper">
        <textarea
          v-model="inputText"
          placeholder="输入消息..."
          rows="1"
          :disabled="sending || (isDirectMode ? !canSendDirect : !swarmId)"
          @keydown="handleKeydown"
        />
        <span v-if="isDirectMode && !canSendDirect" class="input-hint">请先选择模型</span>
        <span v-else-if="!isDirectMode && !swarmId" class="input-hint">请先选择一个 Swarm</span>
      </div>
      <button
        v-if="!active"
        class="send-btn"
        :disabled="(isDirectMode ? !canSendDirect : !swarmId) || sending || !inputText.trim()"
        @click="handleSend"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
      <button
        v-else
        class="send-btn stop"
        @click="abort"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  padding: 16px 24px 24px;
  border-top: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
}

.model-selector {
  max-width: 900px;
  margin: 0 auto 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.model-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.model-chip:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.model-chip.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.chip-provider {
  color: var(--color-text-muted);
  font-size: 11px;
}

.model-chip.active .chip-provider {
  color: rgba(129, 140, 248, 0.7);
}

.chip-separator {
  color: var(--color-text-muted);
  margin: 0 2px;
  font-size: 11px;
}

.chip-model {
  font-weight: 600;
}

.more-models-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.15s;
}

.more-models-btn:hover {
  color: var(--color-text-secondary);
}

.online-model-selector {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle);
}

.provider-model-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.provider-select {
  width: 160px;
  flex-shrink: 0;
}

.model-select-wrapper {
  flex: 1;
  position: relative;
}

.model-input {
  width: 100%;
}

.loading-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 4px 0;
}

.online-model-list {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.online-model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 12px;
  text-align: left;
  color: var(--color-text-secondary);
}

.online-model-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.online-model-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.online-model-id {
  font-family: var(--font-mono);
  font-size: 11px;
}

.online-model-meta {
  font-size: 10px;
  color: var(--color-text-muted);
}

.tool-options {
  max-width: 900px;
  margin: 0 auto 10px;
}

.tool-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  user-select: none;
  cursor: pointer;
}

.tool-toggle input {
  width: 14px;
  height: 14px;
  accent-color: var(--color-accent);
}

.tool-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.input-wrapper {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  max-width: 900px;
  margin: 0 auto;
}

.textarea-wrapper {
  flex: 1;
  position: relative;
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: all 0.2s;
  box-sizing: border-box;
}

.input-field:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.05);
}

.input-field::placeholder {
  color: var(--color-text-muted);
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  padding: 12px 16px;
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 48px;
  max-height: 160px;
  line-height: 1.6;
  transition: all 0.2s;
}

textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

textarea::placeholder {
  color: var(--color-text-muted);
}

textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.send-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

.send-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px var(--color-accent-glow);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn.stop {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.send-btn.stop:hover {
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
}

.send-btn svg {
  width: 18px;
  height: 18px;
}
</style>
