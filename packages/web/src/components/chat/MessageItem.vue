<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatMessage, ToolCallInfo } from "../../types/index.js";
import { agentColor } from "../../utils/agent-color.js";
import { formatTimeShort } from "../../utils/format.js";
import { renderMarkdown } from "../../composables/useMarkdown.js";
import ToolCallCard from "./ToolCallCard.vue";
import ThinkingIcon from "../common/ThinkingIcon.vue";
import SvgIcon from "../common/SvgIcon.vue";

const props = defineProps<{
  message: ChatMessage;
  streaming?: boolean;
  isDirectMode?: boolean;
}>();
const emit = defineEmits<{
  fork: [messageId: string];
}>();

const hasRenderableContent = computed(() => props.message.content.trim().length > 0);

const renderedContent = computed(() => renderMarkdown(props.message.content));
const renderedThinking = computed(() => renderMarkdown(props.message.thinking ?? ""));

const isContextClearedMarker = computed(() => {
  if (props.message.role !== "notification") {
    return false;
  }
  const meta = props.message.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return false;
  }
  return (meta as Record<string, unknown>).type === "context_cleared";
});

const metadataModelLabel = computed(() => {
  const meta = props.message.metadata;
  if (
    !meta
    || typeof meta.provider !== "string"
    || meta.provider.trim().length === 0
    || typeof meta.model !== "string"
    || meta.model.trim().length === 0
  ) {
    return undefined;
  }
  return `${meta.provider}/${meta.model}`;
});

const isRefineFinalReport = computed(() => {
  const refine = props.message.metadata?.refine;
  return Boolean(
    refine
    && typeof refine === "object"
    && !Array.isArray(refine)
    && (refine as Record<string, unknown>).type === "final_report",
  );
});

const displayAgentName = computed(() => {
  if (props.message.role === "assistant") {
    if (props.isDirectMode) {
      return metadataModelLabel.value
        ?? props.message.agentName
        ?? props.message.agentId
        ?? "Assistant";
    }
    return props.message.agentName
      ?? props.message.agentId
      ?? metadataModelLabel.value
      ?? "Assistant";
  }
  return props.message.agentName ?? props.message.agentId ?? "Assistant";
});

const messageImages = computed<Array<{ data: string; mimeType: string }>>(() => {
  return props.message.contentImages ?? [];
});

const previewImageUrl = ref<string | null>(null);
const previewImageMeta = ref<{ data: string; mimeType: string } | null>(null);

function imageDataUrl(img: { data: string; mimeType: string }): string {
  return `data:${img.mimeType};base64,${img.data}`;
}

function openPreview(img: { data: string; mimeType: string }) {
  previewImageUrl.value = imageDataUrl(img);
  previewImageMeta.value = img;
}

function closePreview() {
  previewImageUrl.value = null;
  previewImageMeta.value = null;
}

function downloadImage(img: { data: string; mimeType: string }) {
  const url = imageDataUrl(img);
  const a = document.createElement("a");
  a.href = url;
  a.download = `image.${img.mimeType.split("/")[1] ?? "png"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function roleClass(role: string): string {
  switch (role) {
    case "user": return "msg-user";
    case "assistant": return isRefineFinalReport.value ? "msg-final-report" : "msg-assistant";
    case "tool_result": return "msg-tool";
    case "system": return "msg-system";
    default: return "msg-notification";
  }
}

const formatTime = formatTimeShort;

const copySuccess = ref(false);
const foldedExpandedKeys = ref<Set<string>>(new Set());

interface ToolCallGroup {
  name: string;
  items: ToolCallInfo[];
}

const groupedToolCalls = computed(() => {
  const calls = props.message.toolCalls;
  if (!calls || calls.length <= 1) return null;
  const groups: ToolCallGroup[] = [];
  for (const tc of calls) {
    const prev = groups[groups.length - 1];
    if (prev && prev.name === tc.name && prev.items.length > 0) {
      prev.items.push(tc);
    } else {
      groups.push({ name: tc.name, items: [tc] });
    }
  }
  return groups;
});

const TOOL_FOLD_THRESHOLD = 2;

function toggleFoldedGroup(name: string) {
  const next = new Set(foldedExpandedKeys.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  foldedExpandedKeys.value = next;
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copySuccess.value = true;
    setTimeout(() => { copySuccess.value = false; }, 1500);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = props.message.content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    copySuccess.value = true;
    setTimeout(() => { copySuccess.value = false; }, 1500);
  }
}

function handleFork() {
  if (props.streaming) {
    return;
  }
  emit("fork", props.message.id);
}
</script>

<template>
  <div v-if="isContextClearedMarker" class="context-divider">
    <span class="context-divider-line" />
    <span class="context-divider-label">{{ message.content || "已清空上下文" }}</span>
    <span class="context-divider-line" />
  </div>

  <div v-else class="message-item" :class="[roleClass(message.role)]">
    <div class="msg-body">
      <!-- Header row: agent name + dot for assistant; user label + avatar for user -->
      <div class="msg-header">
        <template v-if="message.role === 'assistant' && isRefineFinalReport">
          <span class="agent-name-with-dot">
            <span class="status-dot" :style="{ background: agentColor(message.agentId ?? message.agentName) }" />
            最终报告 · {{ displayAgentName }}
          </span>
        </template>
        <template v-else-if="message.role === 'assistant'">
          <span class="agent-name-with-dot">
            <span class="status-dot" :style="{ background: agentColor(message.agentId ?? message.agentName) }" />
            {{ displayAgentName }}
          </span>
        </template>
        <template v-else-if="message.role === 'user'">
          <span class="msg-role">你</span>
          <div class="avatar user-avatar-small">
            <SvgIcon name="user" />
          </div>
        </template>
        <template v-else>
          <span class="msg-role">{{ message.role === 'system' ? '系统' : '通知' }}</span>
        </template>
      </div>

      <template v-if="message.parts">
        <template v-for="(part, index) in message.parts" :key="index">
          <div v-if="part.type === 'thinking'" class="msg-thinking">
            <details>
              <summary>
                <ThinkingIcon />
                思考过程
                <span class="chevron">&gt;</span>
              </summary>
              <div class="thinking-content markdown-content" v-html="renderMarkdown(part.content ?? '')" />
            </details>
          </div>
          <div v-if="part.type === 'content'" class="msg-content markdown-content" v-html="renderMarkdown(part.content ?? '')" />
          <div v-if="part.type === 'toolCalls'" class="msg-tool-calls">
            <ToolCallCard
              v-for="tc in part.toolCalls"
              :key="tc.id"
              :tool-call="tc"
            />
          </div>
          <!-- parts path skips folding since streaming messages are transient -->
        </template>
      </template>
      <template v-else>
        <div v-if="message.thinking" class="msg-thinking">
          <details>
            <summary>
              <ThinkingIcon />
              思考过程
              <span class="chevron">&gt;</span>
            </summary>
            <div class="thinking-content markdown-content" v-html="renderedThinking" />
          </details>
        </div>

        <div v-if="messageImages.length > 0" class="msg-images">
          <div v-for="(img, i) in messageImages" :key="i" class="msg-image-wrap">
            <img
              :src="imageDataUrl(img)"
              class="msg-image"
              alt=""
              loading="lazy"
              @dblclick="openPreview(img)"
            />
            <button class="msg-image-download" type="button" title="下载" @click="downloadImage(img)">
              <SvgIcon name="download" :size="12" />
            </button>
          </div>
        </div>

        <div
          v-if="hasRenderableContent"
          class="msg-content markdown-content"
          v-html="renderedContent"
        />

        <div v-if="message.toolCalls?.length" class="msg-tool-calls">
          <template v-if="groupedToolCalls">
            <template v-for="g in groupedToolCalls" :key="g.name">
              <template v-if="g.items.length >= TOOL_FOLD_THRESHOLD">
                <div class="tool-fold-group">
                  <button
                    type="button"
                    class="tool-fold-header"
                    @click="toggleFoldedGroup(g.name)"
                  >
                    <SvgIcon
                      :name="foldedExpandedKeys.has(g.name) ? 'chevronDown' : 'chevronRight'"
                      :size="12"
                    />
                    <span class="tool-fold-name">{{ g.items[0]?.name ?? g.name }}</span>
                    <span class="tool-fold-count">&times;{{ g.items.length }}</span>
                    <span class="tool-fold-dummy" />
                  </button>
                  <div v-if="foldedExpandedKeys.has(g.name)" class="tool-fold-children">
                    <ToolCallCard
                      v-for="tc in g.items"
                      :key="tc.id"
                      :tool-call="tc"
                    />
                  </div>
                </div>
              </template>
              <template v-else>
                <ToolCallCard
                  v-for="tc in g.items"
                  :key="tc.id"
                  :tool-call="tc"
                />
              </template>
            </template>
          </template>
          <template v-else>
            <ToolCallCard
              v-for="tc in message.toolCalls"
              :key="tc.id"
              :tool-call="tc"
            />
          </template>
        </div>
      </template>

      <div class="msg-footer">
        <span v-if="streaming" class="streaming-indicator">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
        </span>
        <span v-else class="timestamp">{{ formatTime(message.timestamp) }}</span>
        <button
          v-if="!streaming"
          class="msg-action-btn"
          type="button"
          title="复制消息"
          @click="handleCopy"
        >
          <template v-if="copySuccess">
            <SvgIcon name="check" />
          </template>
          <template v-else>
            <SvgIcon name="copy" />
          </template>
        </button>
        <button
          v-if="!streaming"
          class="msg-action-btn"
          type="button"
          title="从此消息创建分支"
          @click="handleFork"
        >
          <SvgIcon name="fork" />
        </button>
      </div>
    </div>
  </div>

  <!-- Image preview overlay -->
  <Teleport to="body">
    <div v-if="previewImageUrl" class="image-preview-overlay" @click.self="closePreview">
      <button class="image-preview-close-btn" type="button" @click="closePreview">
        <SvgIcon name="close" :size="18" />
      </button>
      <img :src="previewImageUrl" class="image-preview-full" alt="" />
      <button class="image-preview-download-btn" type="button" title="下载" @click="previewImageMeta && downloadImage(previewImageMeta)">
        <SvgIcon name="download" :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0 8px;
  animation: fadeIn 0.2s ease-out;
}

.context-divider-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.45), transparent);
}

.context-divider-label {
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-muted);
  letter-spacing: 0.2px;
}

.message-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  max-width: 100%;
  animation: fadeIn 0.2s ease-out;
}

/* ── Assistant (left-aligned) ── */
.msg-assistant {
  align-items: flex-start;
}

.msg-assistant .msg-body {
  align-items: flex-start;
  max-width: 100%;
}

.msg-assistant .msg-content {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
}

.msg-final-report {
  align-items: flex-start;
}

.msg-final-report .msg-body {
  align-items: flex-start;
  max-width: 100%;
}

.msg-final-report .msg-content {
  background: var(--color-accent-bg);
  border: 1px solid var(--color-accent);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
}

/* ── User (right-aligned) ── */
.msg-user {
  flex-direction: row-reverse;
  align-items: flex-start;
}

.msg-user .msg-body {
  align-items: flex-end;
  max-width: 80%;
}

.msg-user .msg-header {
  justify-content: flex-end;
}

.msg-user .msg-content {
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
  border-radius: 16px 16px 4px 16px;
  box-shadow: var(--shadow-md);
}

/* ── Tool / System ── */
.msg-tool .msg-content {
  background: var(--bg-success);
  border: 1px solid var(--border-success);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}

.msg-system,
.msg-notification {
  justify-content: center;
}

.msg-system .msg-content,
.msg-notification .msg-content {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-base);
}

/* ── Avatar ── */
.msg-avatar {
  flex-shrink: 0;
  padding-top: 2px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar svg {
  width: 16px;
  height: 16px;
}

.bot-avatar {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.user-avatar-small {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-hover);
  color: var(--text-primary);
}

.user-avatar-small svg {
  width: 12px;
  height: 12px;
}

/* ── Body ── */
.msg-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* ── Header ── */
.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.agent-name-with-dot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  font-size: var(--text-base);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.msg-role {
  font-size: var(--text-base);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

/* ── Content ── */
.msg-content {
  padding: 12px 16px;
  line-height: 1.7;
  word-break: break-word;
}

.markdown-content {
  font-size: var(--text-base);
  margin: 0;
  color: var(--text-primary);
}

.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.msg-image-wrap {
  position: relative;
  flex-shrink: 0;
}

.msg-image-wrap:hover .msg-image-download {
  opacity: 1;
}

.msg-image {
  display: block;
  max-width: 300px;
  max-height: 300px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  object-fit: cover;
  cursor: pointer;
}

.msg-image-download {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.markdown-content :deep(p) {
  margin: 0;
}

.markdown-content :deep(p + p) {
  margin-top: 10px;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.markdown-content :deep(li + li) {
  margin-top: 4px;
}

.markdown-content :deep(a) {
  color: var(--text-secondary);
  text-decoration: underline;
}

.markdown-content :deep(pre) {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  background: var(--bg-root);
  border: 1px solid var(--border-subtle);
}

.markdown-content :deep(pre code.hljs) {
  background: transparent;
  padding: 0;
}

.markdown-content :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.markdown-content :deep(code:not(pre code)) {
  background: var(--bg-hover);
  border-radius: 4px;
  padding: 2px 5px;
}

.markdown-content :deep(blockquote) {
  margin: 10px 0;
  padding-left: 10px;
  color: var(--text-muted);
}

.markdown-content :deep(hr) {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 10px 0;
  font-size: var(--text-base);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  overflow: hidden;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 7px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
}

.markdown-content :deep(th) {
  background: var(--bg-surface);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
}

.markdown-content :deep(td) {
  color: var(--text-secondary);
}

.markdown-content :deep(tr:last-child td) {
  border-bottom: 0;
}

.markdown-content :deep(th:last-child),
.markdown-content :deep(td:last-child) {
  border-right: 0;
}

.markdown-content :deep(tr:nth-child(even) td) {
  background: var(--bg-surface);
}

.markdown-content :deep(.katex) {
  color: var(--text-primary);
  font-size: 1.04em;
}

.markdown-content :deep(.katex-display) {
  margin: 10px 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}

/* ── Footer / Timestamp ── */
.msg-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  min-height: 22px;
  opacity: 0.72;
}

.message-item:hover .msg-footer {
  opacity: 1;
}

.timestamp {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.msg-action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.16s ease, color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.message-item:hover .msg-action-btn {
  opacity: 1;
}

.msg-action-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.msg-action-btn svg {
  width: 13px;
  height: 13px;
}

.streaming-indicator {
  display: flex;
  gap: 3px;
  align-items: center;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: bounce 3.6s ease-in-out infinite both;
}

.dot:nth-child(1) { animation-delay: -0.72s; }
.dot:nth-child(2) { animation-delay: -0.36s; }

@keyframes bounce {
  0%, 75%, 100% { transform: scale(0.75); opacity: 0.65; }
  35% { transform: scale(1); opacity: 0.9; }
}

/* ── Thinking ── */
.msg-thinking {
  margin-top: 4px;
  width: 100%;
}

.msg-thinking details {
  padding: 8px 0;
  font-size: var(--text-base);
}

.msg-thinking summary {
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--weight-medium);
  list-style: none;
}

.msg-thinking summary::-webkit-details-marker {
  display: none;
}

.msg-thinking summary .chevron {
  transition: transform 0.2s;
}

.msg-thinking details[open] summary .chevron {
  transform: rotate(90deg);
}

.msg-thinking .thinking-content {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  margin-top: 8px;
  overflow-wrap: break-word;
  word-break: break-word;
}

/* ── Tool calls ── */
.msg-tool-calls {
  margin-bottom: 1px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
}

.tool-fold-group {
  width: 100%;
}
.tool-fold-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  color: inherit;
  text-align: left;
}
.tool-fold-header:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}
.tool-fold-name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}
.tool-fold-count {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 1px 7px;
  border-radius: 9999px;
  font-weight: var(--weight-bold);
}
.tool-fold-dummy {
  flex: 1;
}
.tool-fold-children {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Image preview overlay ── */
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  cursor: zoom-out;
}

.image-preview-full {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-md);
}

.image-preview-close-btn {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  cursor: pointer;
  z-index: 5001;
}

.image-preview-download-btn {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  z-index: 5001;
  transition: background 0.15s;
}

.image-preview-download-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>
