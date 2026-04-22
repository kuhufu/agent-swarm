<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useChat, type DirectModelSelection } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import type { SavedModel } from "../../types/index.js";

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
const selectedModelValue = ref("");
const showModelSelect = ref(false);

const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);

const canSendDirect = computed(() =>
  directModel.value !== null && directModel.value.provider !== "" && directModel.value.modelId !== "",
);

// Display name for currently selected model
const selectedModelLabel = computed(() => {
  if (!directModel.value) return "";
  const sm = savedModels.value.find(
    (m) => m.provider === directModel.value!.provider && m.modelId === directModel.value!.modelId,
  );
  return sm ? sm.name : `${directModel.value.provider}/${directModel.value.modelId}`;
});

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

function selectSavedModel(sm: SavedModel) {
  selectedModelValue.value = sm.id;
  directModel.value = { provider: sm.provider, modelId: sm.modelId };
  showModelSelect.value = false;
}

function closeModelSelect() {
  showModelSelect.value = false;
}

// When entering direct mode, ensure settings are loaded
watch(() => props.isDirectMode, (isDirect) => {
  if (isDirect && !settingsStore.config) {
    settingsStore.fetchConfig();
  }
}, { immediate: true });

onMounted(() => {
  if (!connected.value) {
    connect();
  }
  if (props.isDirectMode && !settingsStore.config) {
    settingsStore.fetchConfig();
  }
});
</script>

<template>
  <div class="chat-input">
    <div class="tool-options">
      <!-- Direct mode: model selector inline (left-aligned) -->
      <div v-if="isDirectMode" class="model-select-inline">
        <button
          class="model-select-btn"
          :class="{ selected: canSendDirect }"
          @click="showModelSelect = !showModelSelect"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0;">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span v-if="canSendDirect" class="model-select-label">{{ selectedModelLabel }}</span>
          <span v-else class="model-select-label placeholder">选择模型</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px; flex-shrink: 0;">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <!-- Dropdown -->
        <div v-if="showModelSelect" class="model-dropdown">
          <button
            v-for="sm in savedModels"
            :key="sm.id"
            class="model-dropdown-item"
            :class="{ active: selectedModelValue === sm.id }"
            @click="selectSavedModel(sm)"
          >
            <span class="dropdown-model-name">{{ sm.name }}</span>
            <span class="dropdown-model-provider">{{ sm.provider }}</span>
          </button>
          <div v-if="!savedModels.length" class="model-dropdown-empty">
            暂无已配置模型，请先在设置中添加
          </div>
        </div>
      </div>
      <!-- Tool toggles (right-aligned) -->
      <div class="tool-toggles-right">
        <label class="tool-toggle">
          <input v-model="currentTimeToolEnabled" type="checkbox">
          <span>当前时间</span>
        </label>
        <label class="tool-toggle">
          <input v-model="jsExecutionToolEnabled" type="checkbox">
          <span>JS 执行</span>
        </label>
        <label class="tool-toggle">
          <input v-model="thinkModeEnabled" type="checkbox">
          <span>Think</span>
        </label>
      </div>
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

.tool-options {
  max-width: 900px;
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
}

.tool-toggles-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  margin-left: auto;
}

.tool-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

/* ── Inline model selector ── */
.model-select-inline {
  position: relative;
  display: inline-flex;
}

.model-select-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.model-select-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.model-select-btn.selected {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.08);
  color: var(--color-accent-light);
}

.model-select-label {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.model-select-label.placeholder {
  color: var(--color-text-muted);
  font-weight: 400;
}

/* ── Dropdown ── */
.model-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  max-width: 320px;
  max-height: 260px;
  overflow-y: auto;
  z-index: 50;
  background: rgba(20, 22, 35, 0.98);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.model-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
  text-align: left;
  color: var(--color-text-secondary);
}

.model-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.model-dropdown-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.dropdown-model-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-model-provider {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.model-dropdown-item.active .dropdown-model-provider {
  color: rgba(129, 140, 248, 0.6);
}

.model-dropdown-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
}

/* ── Input area ── */
.input-wrapper {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: 900px;
  margin: 0 auto;
}

.textarea-wrapper {
  flex: 1;
  position: relative;
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
  width: 48px;
  height: 48px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
  margin-bottom: 2px;
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
