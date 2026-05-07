<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from "vue";
import { useChat } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import { useConversationStore } from "../../stores/conversation.js";
import SvgIcon from "../common/SvgIcon.vue";
import type { SavedModel } from "../../types/index.js";

const props = defineProps<{
  conversationId?: string | null;
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
  webFetchToolEnabled,
  retrieveKnowledgeToolEnabled,
  wikiToolEnabled,
  workspaceToolEnabled,
  thinkingLevel,
} = useChat(computed(() => props.conversationId ?? null));

const settingsStore = useSettingsStore();
const conversationStore = useConversationStore();

// ── Model selector state ──
const selectedModelValue = ref("");
const showModelSelect = ref(false);

// ── Thinking level state ──
const showThinkLevelSelect = ref(false);

// ── Tools dropdown state ──
const showToolsDropdown = ref(false);

const THINKING_LEVELS = [
  { value: "xhigh", label: "最高" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "off", label: "关闭" },
] as const;

const activeToolCount = computed(() => {
  let count = 0;
  if (currentTimeToolEnabled.value) count++;
  if (jsExecutionToolEnabled.value) count++;
  if (workspaceToolEnabled.value) count++;
  if (webFetchToolEnabled.value) count++;
  if (wikiToolEnabled.value) count++;
  if (retrieveKnowledgeToolEnabled.value) count++;
  return count;
});

const thinkLevelLabel = computed(() => {
  const found = THINKING_LEVELS.find((l) => l.value === thinkingLevel.value);
  return found ? found.label : "关闭";
});

const savedModels = computed<SavedModel[]>(() => settingsStore.models);

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
  if (e.isComposing || e.keyCode === 229) {
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

function handleToggleToolsDropdown() {
  captureTextareaSelection();
  showToolsDropdown.value = !showToolsDropdown.value;
  requestTextareaFocus();
}

function toggleToolFromDropdown(toggleFn: () => void) {
  captureTextareaSelection();
  toggleFn();
}

function toggleCurrentTimeTool() { currentTimeToolEnabled.value = !currentTimeToolEnabled.value; }
function toggleJsExecutionTool() { jsExecutionToolEnabled.value = !jsExecutionToolEnabled.value; }
function toggleWorkspaceTool() { workspaceToolEnabled.value = !workspaceToolEnabled.value; }
function toggleWebFetchTool() { webFetchToolEnabled.value = !webFetchToolEnabled.value; }
function toggleRetrieveKnowledgeTool() { retrieveKnowledgeToolEnabled.value = !retrieveKnowledgeToolEnabled.value; }
function toggleWikiTool() { wikiToolEnabled.value = !wikiToolEnabled.value; }

function handleToggleThinkLevel() {
  captureTextareaSelection();
  showToolsDropdown.value = false;
  showThinkLevelSelect.value = !showThinkLevelSelect.value;
  requestTextareaFocus();
}

function selectThinkingLevel(level: string) {
  thinkingLevel.value = level;
  showThinkLevelSelect.value = false;
}

function toggleModelSelect() {
  captureTextareaSelection();
  showThinkLevelSelect.value = false;
  showModelSelect.value = !showModelSelect.value;
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
  const thinkContainer = (document.querySelector(".think-level-select-inline") as HTMLElement);
  const modelContainer = (document.querySelector(".model-select-inline") as HTMLElement);
  const toolsContainer = (document.querySelector(".tools-dropdown-inline") as HTMLElement);
  if (
    (showThinkLevelSelect.value || showModelSelect.value)
    && thinkContainer && !thinkContainer.contains(target)
    && modelContainer && !modelContainer.contains(target)
  ) {
    showThinkLevelSelect.value = false;
    showModelSelect.value = false;
  }
  if (showToolsDropdown.value && toolsContainer && !toolsContainer.contains(target)) {
    showToolsDropdown.value = false;
  }
  // Close think level dropdown if clicked outside
  if (showThinkLevelSelect.value && thinkContainer && !thinkContainer.contains(target)) {
    showThinkLevelSelect.value = false;
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
        <SvgIcon name="send" />
      </button>
      <button
        v-else
        class="send-btn stop"
        @click="abort"
      >
        <SvgIcon name="stop" />
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
          <SvgIcon name="monitor" :size="14" />
          <span v-if="canSendDirect" class="model-select-label">{{ selectedModelLabel }}</span>
          <span v-else class="model-select-label placeholder">选择模型</span>
          <SvgIcon name="chevronDown" :size="12" />
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
          :class="{ active: searchToolEnabled }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="searchToolEnabled = !searchToolEnabled"
        >
          <SvgIcon name="search" />
          <span>搜索</span>
        </button>
        <!-- Thinking level (not an agent tool) -->
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
            <SvgIcon name="chevronDown" :size="12" />
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
        <div class="tools-dropdown-inline">
          <button
            class="tool-btn"
            :class="{ active: activeToolCount > 0 }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="handleToggleToolsDropdown"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0;">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>工具</span>
            <span v-if="activeToolCount > 0" class="tool-badge">{{ activeToolCount }}</span>
            <SvgIcon name="chevronDown" :size="12" />
          </button>
          <div v-if="showToolsDropdown" class="tools-dropdown">
            <button
              class="tools-dropdown-item"
              :class="{ active: currentTimeToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleCurrentTimeTool)"
            >
              <SvgIcon name="clock" :size="14" />
              <span class="dropdown-tool-label">当前时间</span>
              <span class="dropdown-tool-state">{{ currentTimeToolEnabled ? '开' : '关' }}</span>
            </button>
            <button
              class="tools-dropdown-item"
              :class="{ active: jsExecutionToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleJsExecutionTool)"
            >
              <SvgIcon name="jsExecute" :size="14" />
              <span class="dropdown-tool-label">JS 执行</span>
              <span class="dropdown-tool-state">{{ jsExecutionToolEnabled ? '开' : '关' }}</span>
            </button>
            <button
              class="tools-dropdown-item"
              :class="{ active: workspaceToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleWorkspaceTool)"
            >
              <SvgIcon name="folder" :size="14" />
              <span class="dropdown-tool-label">工作区</span>
              <span class="dropdown-tool-state">{{ workspaceToolEnabled ? '开' : '关' }}</span>
            </button>
            <button
              class="tools-dropdown-item"
              :class="{ active: webFetchToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleWebFetchTool)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0;">
                <path d="M13.5 2C13.5 2 19 5 19 12C19 19 13.5 22 13.5 22" />
                <path d="M2 12h18M6 8l-4 4 4 4" />
              </svg>
              <span class="dropdown-tool-label">抓取网页</span>
              <span class="dropdown-tool-state">{{ webFetchToolEnabled ? '开' : '关' }}</span>
            </button>
            <button
              class="tools-dropdown-item"
              :class="{ active: wikiToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleWikiTool)"
            >
              <SvgIcon name="book" :size="14" />
              <span class="dropdown-tool-label">Wiki</span>
              <span class="dropdown-tool-state">{{ wikiToolEnabled ? '开' : '关' }}</span>
            </button>
            <button
              class="tools-dropdown-item"
              :class="{ active: retrieveKnowledgeToolEnabled }"
              @mousedown="handleKeepTextareaFocusMouseDown"
              @click="toggleToolFromDropdown(toggleRetrieveKnowledgeTool)"
            >
              <SvgIcon name="book" :size="14" />
              <span class="dropdown-tool-label">旧知识库</span>
              <span class="dropdown-tool-state">{{ retrieveKnowledgeToolEnabled ? '开' : '关' }}</span>
            </button>
          </div>
        </div>
        <!-- Clear context (not an agent tool) -->
        <button
          class="tool-btn warn"
          :class="{ disabled: !canClearContext }"
          :title="clearContextTooltip"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="handleClearContext"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0;">
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
  width: min(910px, calc(100% - 32px));
  margin: 6px auto 28px;
  padding: 14px 16px 6px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 20px;
  background: var(--chat-input-bg);
  backdrop-filter: blur(16px) saturate(1.1);
  box-shadow: var(--shadow-input),
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
  box-shadow: var(--shadow-dropdown);
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

/* ── Tools dropdown ── */
.tools-dropdown-inline {
  position: relative;
  display: inline-flex;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.2);
  color: var(--color-accent-light);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.tools-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  z-index: 50;
  background: var(--dropdown-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-dropdown);
  padding: 4px;
}

.tools-dropdown-item {
  display: flex;
  align-items: center;
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

.tools-dropdown-item:hover {
  background: var(--dropdown-hover);
}

.tools-dropdown-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.tools-dropdown-item.warn {
  color: #fbbf24;
}

.tools-dropdown-item.warn:hover:not(.disabled) {
  background: rgba(251, 191, 36, 0.12);
  color: #fcd34d;
}

.tools-dropdown-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dropdown-tool-label {
  flex: 1;
  font-weight: 500;
}

.dropdown-tool-state {
  font-size: 11px;
  color: var(--color-text-muted);
}

.tools-dropdown-item.active .dropdown-tool-state {
  color: rgba(129, 140, 248, 0.6);
}

.tools-dropdown-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border-subtle);
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
  box-shadow: var(--shadow-dropdown);
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
  padding: 16px 16px;
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 60px;
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
    min-height: 52px;
    padding: 14px 14px;
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
