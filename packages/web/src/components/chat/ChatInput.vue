<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useChat, type DirectModelSelection } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import * as configApi from "../../api/config.js";
import type { ProviderInfo, ModelInfo, SavedModel } from "../../types/index.js";

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
const providerList = ref<ProviderInfo[]>([]);
const modelList = ref<ModelInfo[]>([]);
const loadingProviders = ref(false);
const loadingModels = ref(false);
const selectedProvider = ref("");
const selectedModelId = ref("");
const showModelDropdown = ref(false);

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

// ── Provider/model loading ──
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

function selectModel(modelId: string) {
  selectedModelId.value = modelId;
  directModel.value = { provider: selectedProvider.value, modelId };
  showModelDropdown.value = false;
}

function selectSavedModel(sm: SavedModel) {
  selectedProvider.value = sm.provider;
  selectedModelId.value = sm.modelId;
  directModel.value = { provider: sm.provider, modelId: sm.modelId };
  showModelDropdown.value = false;
  loadModels(sm.provider);
}

// When entering direct mode, load providers
watch(() => props.isDirectMode, (isDirect) => {
  if (isDirect && providerList.value.length === 0) {
    loadProviders();
  }
}, { immediate: true });

onMounted(() => {
  if (!connected.value) {
    connect();
  }
  if (props.isDirectMode) {
    loadProviders();
  }
});
</script>

<template>
  <div class="chat-input">
    <!-- Direct mode: model selector -->
    <div v-if="isDirectMode" class="model-selector">
      <div v-if="savedModels.length" class="saved-model-chips">
        <button
          v-for="sm in savedModels"
          :key="sm.id"
          class="model-chip"
          :class="{ active: directModel?.provider === sm.provider && directModel?.modelId === sm.modelId }"
          @click="selectSavedModel(sm)"
        >
          {{ sm.name }}
        </button>
      </div>
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
            @focus="showModelDropdown = modelList.length > 0"
            @input="directModel = selectedProvider && selectedModelId ? { provider: selectedProvider, modelId: selectedModelId } : null"
          />
          <button
            v-if="selectedProvider && modelList.length > 0"
            class="model-dropdown-toggle"
            @click="showModelDropdown = !showModelDropdown"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="showModelDropdown && modelList.length > 0" class="model-dropdown">
            <div
              v-for="m in modelList"
              :key="m.id"
              class="model-dropdown-item"
              :class="{ active: selectedModelId === m.id }"
              @click="selectModel(m.id)"
            >
              <span class="model-dropdown-id">{{ m.id }}</span>
              <span class="model-dropdown-meta">{{ (m.contextWindow / 1000).toFixed(0) }}k ctx</span>
            </div>
          </div>
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
      <span class="tool-hint">工具默认关闭；`Think` 仅对支持 think/no_think 的模型生效</span>
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

.saved-model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.model-chip {
  padding: 4px 10px;
  border-radius: 6px;
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

.provider-model-row {
  display: flex;
  gap: 8px;
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
  padding-right: 32px;
}

.model-dropdown-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.model-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 4px;
  max-height: 240px;
  overflow-y: auto;
  background: rgba(20, 22, 35, 0.98);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.model-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 12px;
}

.model-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.model-dropdown-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.model-dropdown-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.model-dropdown-item.active .model-dropdown-id {
  color: var(--color-accent-light);
}

.model-dropdown-meta {
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
