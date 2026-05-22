<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from "vue";
import { useChat } from "../../composables/useChat.js";
import { useSettingsStore } from "../../stores/settings.js";
import { useConversationStore } from "../../stores/conversation.js";
import { showError } from "../../utils/ui-feedback.js";
import { uploadImage, readFileAsDataURL } from "../../utils/image-upload.js";
import SvgIcon from "../common/SvgIcon.vue";
import type { SavedModel } from "../../types/index.js";

const props = defineProps<{
  conversationId?: string | null;
  swarmId: string;
  active?: boolean;
  isDirectMode?: boolean;
  workspaceId?: string | null;
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
  askUserToolEnabled,
  webFetchToolEnabled,
  knowledgeToolEnabled,
  workspaceToolEnabled,
  browserAutomationToolEnabled,
  thinkingLevel,
  pendingImageIds,
  pendingImageUrls,
} = useChat(
  computed(() => props.conversationId ?? null),
  computed(() => props.workspaceId ?? null),
);

const conversationId = computed(() => props.conversationId ?? null);
const pendingPreviews = ref<Array<{ id: string; url: string; mimeType: string; name: string }>>([]);
const uploadingImages = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const settingsStore = useSettingsStore();
const conversationStore = useConversationStore();

// ── Model image support check ──
const modelSupportsImages = computed(() => {
  if (!props.isDirectMode) return false;
  const model = directModel.value;
  if (!model) return false;
  const saved = savedModels.value.find(
    (m) => m.provider === model.provider && m.modelId === model.modelId,
  );
  return saved?.input?.includes("image") ?? false;
});

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
  if (askUserToolEnabled.value) count++;
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
function toggleAskUserTool() { askUserToolEnabled.value = !askUserToolEnabled.value; }
function toggleWorkspaceTool() {
  if (!props.workspaceId) {
    showError("请先选择工作区");
    return;
  }
  workspaceToolEnabled.value = !workspaceToolEnabled.value;
}
function toggleWebFetchTool() { webFetchToolEnabled.value = !webFetchToolEnabled.value; }
function toggleBrowserAutomationTool() { browserAutomationToolEnabled.value = !browserAutomationToolEnabled.value; }

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

watch(pendingImageIds, (ids) => {
  if (ids.length === 0 && pendingPreviews.value.length > 0) {
    pendingPreviews.value = [];
  }
});

async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items?.length) return;

  const imageFiles: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (imageFiles.length === 0) return;

  // Check if model supports images
  if (!modelSupportsImages.value) {
    showError("当前模型不支持图片");
    return;
  }

  event.preventDefault();

  for (const file of imageFiles) {
    await uploadAndPreview(file);
  }
}

async function uploadAndPreview(file: File) {
  if (pendingPreviews.value.length >= 10) {
    showError("最多上传 10 张图片");
    return;
  }

  try {
    uploadingImages.value = true;
    const url = await readFileAsDataURL(file);

    const tempId = crypto.randomUUID();
    pendingPreviews.value.push({ id: tempId, url, mimeType: file.type, name: file.name });

    const result = await uploadImage(file);
    
    // Replace temp ID with real server ID
    const preview = pendingPreviews.value.find((p) => p.id === tempId);
    if (preview) {
      pendingImageIds.value = [...pendingImageIds.value.filter((id) => id !== tempId), result.id];
      pendingImageUrls.value = [...pendingImageUrls.value, preview.url];
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : "上传图片失败");
  } finally {
    uploadingImages.value = false;
  }
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  for (const file of Array.from(files)) {
    void uploadAndPreview(file);
  }
  input.value = "";
}

function removePreview(id: string) {
  pendingPreviews.value = pendingPreviews.value.filter((p) => p.id !== id);
  pendingImageIds.value = pendingImageIds.value.filter((i) => i !== id);
}

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
  window.addEventListener("agent-swarm:fill-input", handleFillInput);
  window.addEventListener("paste", handlePaste as unknown as EventListener);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick);
  window.removeEventListener("agent-swarm:fill-input", handleFillInput);
  window.removeEventListener("paste", handlePaste as unknown as EventListener);
  if (focusDebounceTimer) {
    clearTimeout(focusDebounceTimer);
  }
});

function handleFillInput(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (detail?.text) {
    inputText.value = detail.text;
    requestTextareaFocus();
    nextTick(() => resizeTextarea());
  }
}

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
    <textarea
      ref="textareaRef"
      v-model="inputText"
      placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
      rows="1"
      autofocus
      :disabled="sending || (isDirectMode ? !canSendDirect : !swarmId)"
      @focus="captureTextareaSelection"
      @click="captureTextareaSelection"
      @keyup="captureTextareaSelection"
      @select="captureTextareaSelection"
      @keydown="handleKeydown"
    />
    <div v-if="pendingPreviews.length > 0" class="image-preview-bar">
      <div v-for="preview in pendingPreviews" :key="preview.id" class="image-preview-item">
        <img :src="preview.url" :alt="preview.name" />
        <button class="image-preview-remove" type="button" @click="removePreview(preview.id)">
          <SvgIcon name="close" :size="10" />
        </button>
      </div>
      <div v-if="uploadingImages" class="image-preview-item uploading">
        <div class="upload-spinner" />
      </div>
    </div>
    <div class="tool-options">
      <input ref="fileInputRef" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple style="display:none" :disabled="!modelSupportsImages" @change="handleFileSelect" />
      <button class="tool-btn" :class="{ disabled: !modelSupportsImages }" :title="modelSupportsImages ? '附件' : '当前模型不支持图片'" @mousedown="handleKeepTextareaFocusMouseDown" @click="modelSupportsImages && fileInputRef?.click()">
        <SvgIcon name="attachment" :size="15" />
      </button>

      <!-- Direct mode: model selector inline -->
      <div v-if="isDirectMode" class="model-select-inline">
        <button
          class="model-select-btn"
          :class="{ selected: canSendDirect }"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="toggleModelSelect"
        >
          <SvgIcon name="monitor" :size="13" />
          <span v-if="canSendDirect" class="model-select-label">{{ selectedModelLabel }}</span>
          <span v-else class="model-select-label placeholder">选择模型</span>
          <SvgIcon name="chevronDown" :size="11" />
        </button>
        <div v-if="showModelSelect" class="model-dropdown">
          <button
            v-for="sm in savedModels"
            :key="sm.id"
            class="model-dropdown-item"
            :class="{ active: selectedModelValue === sm.id }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="selectSavedModel(sm)"
          >
            <SvgIcon v-if="selectedModelValue === sm.id" name="check" :size="12" />
            <span v-else class="model-check-placeholder" />
            <span class="dropdown-model-name">{{ sm.name }}</span>
            <span class="dropdown-model-provider">{{ sm.provider }}</span>
          </button>
          <div v-if="!savedModels.length" class="model-dropdown-empty">
            暂无已配置模型，请先在设置中添加
          </div>
        </div>
      </div>

      <!-- Thinking level -->
      <div class="think-level-select-inline">
        <button
          class="tool-btn"
          :class="{ active: thinkingLevel !== 'off' }"
          :title="'思考深度: ' + thinkLevelLabel"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="handleToggleThinkLevel"
        >
          <SvgIcon name="lightbulb" :size="14" />
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
          </button>
        </div>
      </div>

      <!-- Chat / conversation toggle -->
      <!-- <button
        class="tool-btn"
        title="对话历史"
        @mousedown="handleKeepTextareaFocusMouseDown"
      >
        <SvgIcon name="chat" :size="14" />
      </button> -->

      <!-- Voice input -->
      <!-- <button
        class="tool-btn"
        title="语音输入"
        @mousedown="handleKeepTextareaFocusMouseDown"
      >
        <SvgIcon name="mic" :size="14" />
      </button> -->

      <!-- Workspace -->
      <button
        class="tool-btn"
        :class="{ active: workspaceToolEnabled }"
        title="工作区"
        @mousedown="handleKeepTextareaFocusMouseDown"
        @click="toggleWorkspaceTool"
      >
        <SvgIcon name="folder" :size="14" />
      </button>

      <!-- Web fetch -->
      <button
        class="tool-btn"
        :class="{ active: webFetchToolEnabled }"
        title="抓取网页"
        @mousedown="handleKeepTextareaFocusMouseDown"
        @click="toggleWebFetchTool"
      >
        <SvgIcon name="globe" :size="14" />
      </button>

      <!-- Browser automation -->
      <!-- moved to tools dropdown -->

      <!-- Knowledge (Wiki + Knowledge base) -->
      <button
        class="tool-btn"
        :class="{ active: knowledgeToolEnabled }"
        title="知识库 / Wiki"
        @mousedown="handleKeepTextareaFocusMouseDown"
        @click="knowledgeToolEnabled = !knowledgeToolEnabled"
      >
        <SvgIcon name="book" :size="14" />
      </button>

      <!-- Tools dropdown (剩余工具) -->
      <div class="tools-dropdown-inline">
        <button
          class="tool-btn"
          :class="{ active: activeToolCount > 0 }"
          title="更多工具"
          @mousedown="handleKeepTextareaFocusMouseDown"
          @click="handleToggleToolsDropdown"
        >
          <SvgIcon name="wrench" :size="14" />
          <span v-if="activeToolCount > 0" class="tool-badge">{{ activeToolCount }}</span>
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
          </button>
          <button
            class="tools-dropdown-item"
            :class="{ active: jsExecutionToolEnabled }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="toggleToolFromDropdown(toggleJsExecutionTool)"
          >
            <SvgIcon name="jsExecute" :size="14" />
            <span class="dropdown-tool-label">JS 执行</span>
          </button>
          <button
            class="tools-dropdown-item"
            :class="{ active: askUserToolEnabled }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="toggleToolFromDropdown(toggleAskUserTool)"
          >
            <SvgIcon name="user" :size="14" />
            <span class="dropdown-tool-label">询问用户</span>
          </button>
          <button
            class="tools-dropdown-item"
            :class="{ active: browserAutomationToolEnabled }"
            @mousedown="handleKeepTextareaFocusMouseDown"
            @click="toggleToolFromDropdown(toggleBrowserAutomationTool)"
          >
            <SvgIcon name="monitor" :size="14" />
            <span class="dropdown-tool-label">浏览器</span>
          </button>
        </div>
      </div>

      <!-- Link / chain -->
      <!-- <button class="tool-btn" title="链接" @mousedown="handleKeepTextareaFocusMouseDown">
        <SvgIcon name="link" :size="14" />
      </button> -->

      <!-- Spacer -->
      <div class="toolbar-spacer" />

      <!-- Send / Stop button -->
      <button
        v-if="!active"
        class="send-btn"
        :disabled="(isDirectMode ? !canSendDirect : !swarmId) || sending || !inputText.trim()"
        @click="handleSend"
      >
        <SvgIcon name="send" :size="16" />
      </button>
      <button
        v-else
        class="send-btn stop"
        @click="abort"
      >
        <SvgIcon name="stop" :size="16" />
      </button>

      <!-- Clear context -->
      <button
        class="tool-btn"
        :class="{ disabled: !canClearContext }"
        :title="clearContextTooltip"
        @mousedown="handleKeepTextareaFocusMouseDown"
        @click="handleClearContext"
      >
        <SvgIcon name="eraser" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-input {
  width: min(820px, calc(100% - 32px));
  margin: 0px auto 28px;
  padding: 14px 18px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  background: var(--bg-surface);
  backdrop-filter: blur(16px) saturate(1.1);
  box-shadow: var(--shadow-md),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
}

textarea {
  width: 100%;
  display: block;
  box-sizing: border-box;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--text-base);
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 72px;
  max-height: 280px;
  line-height: 1.6;
  transition: all 0.2s;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.28) transparent;
  padding: 0;
}

textarea::-webkit-scrollbar {
  width: 6px;
}

textarea::-webkit-scrollbar-track {
  background: transparent;
}

textarea::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.24);
  border-radius: 999px;
  border: 1.5px solid transparent;
  background-clip: padding-box;
}

textarea::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.38);
  background-clip: padding-box;
}

textarea:focus {
  box-shadow: none;
}

textarea::placeholder {
  color: var(--text-muted);
}

textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Toolbar ── */
.tool-options {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  margin-top: 10px;
}

.toolbar-spacer {
  flex: 1;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1;
  flex-shrink: 0;
}

.tool-btn:hover:not(.disabled) {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.tool-btn.active {
  color: var(--text-primary);
}

.tool-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tool-btn svg {
  width: 15px;
  height: 15px;
}

/* ── Send button (inline in toolbar) ── */
.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  border-radius: 7px;
  border: none;
  background: var(--bg-hover);
  color: var(--text-primary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.18s ease;
}

.send-btn:hover:not(:disabled) {
  color: #fff;
}

.send-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.send-btn.stop {
  background: var(--color-danger);
  color: #fff;
}

.send-btn.stop:hover {
  box-shadow: 0 2px 10px rgba(239, 68, 68, 0.35);
}

/* ── Model selector inline ── */
.model-select-inline {
  position: relative;
  display: inline-flex;
}

.model-select-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  height: 30px;
}

.model-select-btn:hover {
  border-color: var(--border-default);
  color: var(--text-primary);
}

.model-select-btn.selected {
  color: var(--text-primary);
}

.model-select-label {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--weight-medium);
}

.model-select-label.placeholder {
  color: var(--text-muted);
  font-weight: var(--weight-normal);
}

/* ── Dropdowns ── */
.model-dropdown,
.tools-dropdown,
.think-level-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 4px;
}

.model-dropdown {
  min-width: 220px;
  max-width: 320px;
  max-height: 260px;
  overflow-y: auto;
}

.tools-dropdown {
  min-width: 160px;
}

.think-level-dropdown {
  min-width: 110px;
}

.tools-dropdown-item,
.model-dropdown-item,
.think-level-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-base);
  text-align: left;
  color: var(--text-secondary);
  transition: background 0.1s;
}

.tools-dropdown-item:hover,
.model-dropdown-item:hover,
.think-level-dropdown-item:hover {
  background: var(--bg-hover);
}

.tools-dropdown-item.active,
.model-dropdown-item.active,
.think-level-dropdown-item.active {
  color: var(--text-primary);
}

.model-check-placeholder {
  width: 12px;
  flex-shrink: 0;
}

.dropdown-model-name {
  flex: 1;
  font-weight: var(--weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-model-provider {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.model-dropdown-empty {
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: center;
}

.dropdown-tool-label,
.dropdown-level-label {
  font-weight: var(--weight-medium);
}

/* ── Tool badge ── */
.tool-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--text-muted);
  color: var(--bg-root);
  font-size: 9px;
  font-weight: var(--weight-bold);
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

.tools-dropdown-inline,
.think-level-select-inline {
  position: relative;
  display: inline-flex;
}

.image-preview-bar {
  display: flex;
  gap: 8px;
  padding: 0 0 8px;
  flex-wrap: wrap;
}

.image-preview-item {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  flex-shrink: 0;
}

.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-preview-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--bg-overlay);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.image-preview-item:hover .image-preview-remove {
  opacity: 1;
}

.image-preview-item.uploading {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
}

.upload-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--text-muted);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .chat-input {
    width: calc(100% - 16px);
    margin: 8px auto 10px;
    padding: 12px 14px 10px;
    border-radius: 16px;
  }

  textarea {
    min-height: 40px;
    max-height: 200px;
  }

  .tool-options {
    gap: 2px;
    flex-wrap: wrap;
  }

  .send-btn {
    width: 32px;
    height: 28px;
  }
}
</style>
