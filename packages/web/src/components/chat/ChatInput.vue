<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from "vue";
import { useChat } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import { useConversationStore } from "../../stores/conversation.js";
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
  canClearContext,
  clearContext,
  directModel,
  currentTimeToolEnabled,
  jsExecutionToolEnabled,
  searchToolEnabled,
  thinkingLevel,
} = useChat();

const settingsStore = useSettingsStore();
const conversationStore = useConversationStore();

// ── Model selector state ──
const selectedModelValue = ref("");
const showModelSelect = ref(false);

// ── Thinking level state ──
const showThinkLevelSelect = ref(false);

const THINKING_LEVELS = [
  { value: "xhigh", label: "最高" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "off", label: "关闭" },
] as const;

const thinkLevelLabel = computed(() => {
  const found = THINKING_LEVELS.find((l) => l.value === thinkingLevel.value);
  return found ? found.label : "关闭";
});

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

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const MAX_TEXTAREA_ROWS = 12;
let pendingFocusRequest = false;
let pendingSelectionRestore = true;
let lastSelectionStart = 0;
let lastSelectionEnd = 0;
let focusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const isTextareaEnabled = computed(() =>
  !sending.value && (props.isDirectMode ? canSendDirect.value : Boolean(props.swarmId)),
);

function tryFocusTextarea(): boolean {
  const textarea = textareaRef.value;
  if (!textarea || textarea.disabled) {
    return false;
  }
  if (document.activeElement === textarea) {
    return true;
  }
  textarea.focus();
  if (pendingSelectionRestore) {
    const valueLength = textarea.value.length;
    const nextStart = Math.min(lastSelectionStart, valueLength);
    const nextEnd = Math.min(lastSelectionEnd, valueLength);
    textarea.setSelectionRange(nextStart, nextEnd);
  }
  return true;
}

function requestTextareaFocus(restoreSelection = true) {
  pendingFocusRequest = true;
  pendingSelectionRestore = pendingSelectionRestore || restoreSelection;
  if (focusDebounceTimer) {
    clearTimeout(focusDebounceTimer);
  }
  focusDebounceTimer = setTimeout(() => {
    focusDebounceTimer = null;
    if (tryFocusTextarea()) {
      pendingFocusRequest = false;
      pendingSelectionRestore = true;
    }
  }, 50);
}

function captureTextareaSelection() {
  const textarea = textareaRef.value;
  if (!textarea) {
    return;
  }
  lastSelectionStart = textarea.selectionStart ?? textarea.value.length;
  lastSelectionEnd = textarea.selectionEnd ?? lastSelectionStart;
}

function handleContainerMouseDown(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (
    target.closest("textarea")
    || target.closest("button")
    || target.closest("input")
    || target.closest("select")
    || target.closest("a")
    || target.closest("[role='button']")
    || target.closest("[contenteditable='true']")
  ) {
    return;
  }
  if (!isTextareaEnabled.value) {
    return;
  }
  captureTextareaSelection();
  event.preventDefault();
  requestTextareaFocus(true);
}

function handleKeepTextareaFocusMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }
  captureTextareaSelection();
  event.preventDefault();
}

// Consolidate focus triggers — single watch to avoid multiple focus attempts
watch(
  () => [props.swarmId, props.isDirectMode, sending.value, conversationStore.inputFocusRequestKey],
  () => {
    requestTextareaFocus();
  },
);

const clearContextTooltip = computed(() =>
  canClearContext.value
    ? "仅清空当前会话推理上下文，不删除历史消息"
    : "会话运行中或未进入会话，暂时无法清空上下文",
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

function resizeTextarea() {
  const textarea = textareaRef.value;
  if (!textarea) {
    return;
  }
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  const maxHeight = (lineHeight * MAX_TEXTAREA_ROWS) + paddingTop + paddingBottom + borderTop + borderBottom;

  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(contentHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  // Keep vertical scrollbar policy stable to avoid content width jitter.
  textarea.style.overflowY = "auto";
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter") {
    return;
  }
  if (e.ctrlKey) {
    return;
  }
  if (!e.shiftKey) {
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
  captureTextareaSelection();
  selectedModelValue.value = sm.id;
  directModel.value = { provider: sm.provider, modelId: sm.modelId };
  showModelSelect.value = false;
  showThinkLevelSelect.value = false;
  requestTextareaFocus();
}

function handleToggleCurrentTimeTool() {
  captureTextareaSelection();
  currentTimeToolEnabled.value = !currentTimeToolEnabled.value;
  requestTextareaFocus();
}

function handleToggleJsExecutionTool() {
  captureTextareaSelection();
  jsExecutionToolEnabled.value = !jsExecutionToolEnabled.value;
  requestTextareaFocus();
}

function handleToggleThinkLevel() {
  captureTextareaSelection();
  showModelSelect.value = false;
  showThinkLevelSelect.value = !showThinkLevelSelect.value;
  requestTextareaFocus();
}

function toggleModelSelect() {
  captureTextareaSelection();
  showThinkLevelSelect.value = false;
  showModelSelect.value = !showModelSelect.value;
  requestTextareaFocus();
}

function selectThinkingLevel(level: string) {
  thinkingLevel.value = level;
  showThinkLevelSelect.value = false;
  requestTextareaFocus();
}

async function handleClearContext() {
  if (!canClearContext.value) {
    return;
  }
  await clearContext();
}

// When entering direct mode, ensure settings are loaded and auto-select first model
watch(() => props.isDirectMode, (isDirect) => {
  if (!isDirect) return;
  if (!settingsStore.config) {
    settingsStore.fetchConfig();
    return;
  }
  if (savedModels.value.length > 0 && !directModel.value) {
    selectSavedModel(savedModels.value[0]);
  }
}, { immediate: true });

// Auto-select first model in direct mode
watch(savedModels, (models) => {
  if (props.isDirectMode && models.length > 0 && !directModel.value) {
    selectSavedModel(models[0]);
  }
}, { immediate: true });

// Re-select model when it's cleared (e.g., clicking "直接对话" again while already in direct mode)
watch(directModel, (model) => {
  if (props.isDirectMode && !model && savedModels.value.length > 0) {
    selectSavedModel(savedModels.value[0]);
  }
});

watch([directModel, savedModels], ([model, models]) => {
  if (!model) {
    selectedModelValue.value = "";
    return;
  }
  const matched = models.find(
    (item) => item.provider === model.provider && item.modelId === model.modelId,
  );
  selectedModelValue.value = matched?.id ?? "";
}, { immediate: true });

watch(inputText, () => {
  nextTick(() => {
    resizeTextarea();
  });
}, { flush: "post" });

onMounted(() => {
  captureTextareaSelection();
  requestTextareaFocus();
  nextTick(() => {
    resizeTextarea();
  });
  if (!connected.value) {
    connect();
  }
  if (props.isDirectMode && !settingsStore.config) {
    settingsStore.fetchConfig();
  }

  document.addEventListener("mousedown", handleOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick);
  if (focusDebounceTimer) {
    clearTimeout(focusDebounceTimer);
  }
});

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node;
  if (!target) return;
  if (showThinkLevelSelect.value || showModelSelect.value) {
    const thinkContainer = (document.querySelector(".think-level-select-inline") as HTMLElement);
    const modelContainer = (document.querySelector(".model-select-inline") as HTMLElement);
    if (
      thinkContainer && !thinkContainer.contains(target)
      && modelContainer && !modelContainer.contains(target)
    ) {
      showThinkLevelSelect.value = false;
      showModelSelect.value = false;
    }
  }
}
</script>

<template>
  <div class="chat-input" @mousedown="handleContainerMouseDown">
    <div class="input-wrapper">
      <div class="textarea-wrapper">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          placeholder="输入消息..."
          rows="1"
          autofocus
          :disabled="sending || (isDirectMode ? !canSendDirect : !swarmId)"
          @focus="captureTextareaSelection"
          @click="captureTextareaSelection"
          @keyup="captureTextareaSelection"
          @select="captureTextareaSelection"
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
    <div class="tool-options">
      <!-- Direct mode: model selector inline (left-aligned) -->
      <div v-if="isDirectMode" class="model-select-inline">
        <button
          class="model-select-btn"
          :class="{ selected: canSendDirect }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="toggleModelSelect"
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
            @mousedown="handleKeepTextareaFocusMouseDown"
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
        <button
          class="tool-btn"
          :class="{ active: currentTimeToolEnabled }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="handleToggleCurrentTimeTool"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>当前时间</span>
        </button>
        <button
          class="tool-btn"
          :class="{ active: jsExecutionToolEnabled }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="handleToggleJsExecutionTool"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>JS 执行</span>
        </button>
        <button
          class="tool-btn"
          :class="{ active: searchToolEnabled }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="searchToolEnabled = !searchToolEnabled"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>搜索</span>
        </button>
        <div class="think-level-select-inline">
          <button
            class="tool-btn"
            :class="{ active: thinkingLevel !== 'off' }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="handleToggleThinkLevel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0;">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>{{ thinkLevelLabel }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px; flex-shrink: 0;">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="showThinkLevelSelect" class="think-level-dropdown">
            <button
              v-for="lvl in THINKING_LEVELS"
              :key="lvl.value"
              class="think-level-dropdown-item"
              :class="{ active: thinkingLevel === lvl.value }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="selectThinkingLevel(lvl.value)"
            >
              <span class="dropdown-level-label">{{ lvl.label }}</span>
              <span class="dropdown-level-value">{{ lvl.value }}</span>
            </button>
          </div>
        </div>
        <button
          class="tool-btn warn"
          :class="{ disabled: !canClearContext }"
          :title="clearContextTooltip"
          @click="handleClearContext"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          <span>清空上下文</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  width: min(980px, calc(100% - 32px));
  margin: 10px auto 14px;
  padding: 12px 16px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 20px;
  background: var(--chat-input-bg);
  backdrop-filter: blur(16px) saturate(1.1);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  position: relative;
  z-index: 3;
}

.tool-options {
  max-width: none;
  margin: 10px 0 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
}

.tool-toggles-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tool-btn:hover {
  background: var(--dropdown-hover);
  color: var(--color-text-secondary);
}

.tool-btn.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.2);
  color: var(--color-accent-light);
}

.tool-btn.warn {
  color: #fbbf24;
}

.tool-btn.warn:hover:not(.disabled) {
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.25);
  color: #fcd34d;
}

.tool-btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tool-btn svg {
  width: 14px;
  height: 14px;
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
  background: var(--dropdown-bg);
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
  background: var(--dropdown-hover);
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

/* ── Thinking level selector ── */
.think-level-select-inline {
  position: relative;
  display: inline-flex;
}
.think-level-select-inline .tool-btn {
  width: 80px;
  gap: 2px;
}
.think-level-select-inline .tool-btn span:nth-child(2) {
  display: inline-block;
  width: 28px;
  text-align: center;
}

.think-level-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 140px;
  z-index: 50;
  background: var(--dropdown-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.think-level-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 13px;
  text-align: left;
  color: var(--color-text-secondary);
}

.think-level-dropdown-item:hover {
  background: var(--dropdown-hover);
}

.think-level-dropdown-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.dropdown-level-label {
  font-weight: 500;
}

.dropdown-level-value {
  font-size: 11px;
  color: var(--color-text-muted);
}

.think-level-dropdown-item.active .dropdown-level-value {
  color: rgba(129, 140, 248, 0.6);
}

/* ── Input area ── */
.input-wrapper {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: none;
  margin: 0;
}

.textarea-wrapper {
  flex: 1;
  position: relative;
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  background: var(--input-bg);
  overflow: hidden;
  transition: all 0.2s;
}

.textarea-wrapper:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

textarea {
  width: 100%;
  display: block;
  box-sizing: border-box;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 12px 16px;
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 48px;
  max-height: none;
  line-height: 1.6;
  transition: all 0.2s;
  /* Keep content paddings fixed at 16px while reserving scrollbar slot. */
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
}

textarea::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

textarea::-webkit-scrollbar-track {
  background: transparent;
}

textarea::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

textarea::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
  background-clip: padding-box;
}

textarea:focus {
  box-shadow: none;
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
  border-radius: 50%;
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

@media (max-width: 768px) {
  .chat-input {
    width: calc(100% - 16px);
    margin: 8px auto 10px;
    padding: 10px 12px 12px;
    border-radius: 16px;
  }

  .input-wrapper {
    gap: 8px;
  }

  textarea {
    min-height: 44px;
    padding: 10px 14px;
  }

  .send-btn {
    width: 44px;
    height: 44px;
  }

  .tool-options {
    margin-top: 8px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tool-toggles-right {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }

  .model-select-label {
    max-width: 140px;
  }
}
</style>
