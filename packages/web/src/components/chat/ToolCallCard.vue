<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import type { ToolCallInfo } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

interface KnowledgeReference {
  documentId?: string;
  title: string;
  source?: string;
  chunkIndex?: number;
  score?: number;
  content: string;
}

interface JavascriptExecutionView {
  code: string;
  result: string;
  logs: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeKnowledgeReference(value: unknown): KnowledgeReference | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }

  const document = asRecord(raw.document);
  const chunk = asRecord(raw.chunk);
  const title = typeof document?.title === "string" && document.title.trim().length > 0
    ? document.title
    : "未命名文档";
  const content = typeof chunk?.content === "string"
    ? chunk.content.trim()
    : "";

  if (!content) {
    return null;
  }

  return {
    documentId: typeof document?.id === "string" && document.id.trim().length > 0
      ? document.id
      : undefined,
    title,
    source: typeof document?.source === "string" && document.source.trim().length > 0
      ? document.source
      : undefined,
    chunkIndex: typeof chunk?.index === "number" ? chunk.index : undefined,
    score: typeof raw.score === "number" ? raw.score : undefined,
    content,
  };
}

function extractKnowledgeReferences(result: unknown): KnowledgeReference[] | null {
  if (Array.isArray(result)) {
    return result.map(normalizeKnowledgeReference).filter((item): item is KnowledgeReference => item !== null);
  }

  const raw = asRecord(result);
  if (raw && Array.isArray(raw.details)) {
    return raw.details.map(normalizeKnowledgeReference).filter((item): item is KnowledgeReference => item !== null);
  }

  return null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => stringifyUnknown(item));
}

function extractJavascriptExecution(result: unknown, args: unknown): JavascriptExecutionView | null {
  const raw = asRecord(result);
  const details = asRecord(raw?.details) ?? raw;
  if (!details) {
    return null;
  }

  const argsRecord = asRecord(args);
  const code = typeof details.code === "string"
    ? details.code
    : (typeof argsRecord?.code === "string" ? argsRecord.code : "");
  const jsResult = stringifyUnknown(details.result);
  const logs = normalizeStringArray(details.logs);

  if (!code && jsResult.length === 0 && logs.length === 0) {
    return null;
  }

  return {
    code,
    result: jsResult.length > 0 ? jsResult : "undefined",
    logs,
  };
}

const expanded = ref(false);
const copiedReferenceKey = ref<string | null>(null);
const isKnowledgeTool = computed(() => props.toolCall.name === "retrieve_knowledge");
const isJavascriptTool = computed(() => props.toolCall.name === "javascript_execute");
const knowledgeReferences = computed(() => isKnowledgeTool.value
  ? extractKnowledgeReferences(props.toolCall.result)
  : null);
const javascriptExecution = computed(() => isJavascriptTool.value
  ? extractJavascriptExecution(props.toolCall.result, props.toolCall.arguments)
  : null);
const hasKnowledgeResult = computed(() => isKnowledgeTool.value && props.toolCall.result !== undefined);
const hasJavascriptResult = computed(() => isJavascriptTool.value && javascriptExecution.value !== null);
const queryText = computed(() => {
  const args = asRecord(props.toolCall.arguments);
  return typeof args?.query === "string" ? args.query : "";
});
const status = computed(() => {
  if (props.toolCall.isError === true) {
    return { label: "失败", cls: "error" };
  }
  if (props.toolCall.isError === false) {
    return { label: "完成", cls: "success" };
  }
  return { label: "运行中", cls: "running" };
});

function referenceKey(reference: KnowledgeReference, index: number): string {
  return `${reference.documentId ?? reference.title}-${reference.chunkIndex ?? index}-${index}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

async function handleCopyReference(reference: KnowledgeReference, index: number) {
  const key = referenceKey(reference, index);
  await copyText(reference.content);
  copiedReferenceKey.value = key;
  setTimeout(() => {
    if (copiedReferenceKey.value === key) {
      copiedReferenceKey.value = null;
    }
  }, 1500);
}
</script>

<template>
  <div class="tool-call-card" :class="{ expanded }" @click="expanded = !expanded">
    <div class="tool-header">
      <div class="tool-icon-wrapper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span :class="['tool-status', status.cls]">
        {{ status.label }}
      </span>
      <SvgIcon class="expand-icon" :class="{ rotated: expanded }" name="chevronDown" :size="14" />
    </div>
    <div v-if="expanded" class="tool-details">
      <div class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          参数
        </span>
        <pre>{{ JSON.stringify(toolCall.arguments, null, 2) }}</pre>
      </div>
      <div v-if="hasKnowledgeResult" class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          知识库引用
        </span>
        <div class="knowledge-summary">
          <span v-if="queryText">查询：{{ queryText }}</span>
          <span>{{ knowledgeReferences?.length ?? 0 }} 条引用</span>
        </div>
        <div v-if="knowledgeReferences && knowledgeReferences.length > 0" class="knowledge-list">
          <article
            v-for="(reference, index) in knowledgeReferences"
            :key="referenceKey(reference, index)"
            class="knowledge-reference"
          >
            <header class="reference-header">
              <span class="reference-index">{{ index + 1 }}</span>
              <div class="reference-meta">
                <RouterLink
                  v-if="reference.documentId"
                  class="reference-title reference-link"
                  :to="{ name: 'documents', query: { doc: reference.documentId, chunk: reference.chunkIndex } }"
                  @click.stop
                >
                  {{ reference.title }}
                </RouterLink>
                <div v-else class="reference-title">{{ reference.title }}</div>
                <div class="reference-subtitle">
                  <span v-if="reference.source">{{ reference.source }}</span>
                  <span v-if="reference.chunkIndex !== undefined">片段 #{{ reference.chunkIndex + 1 }}</span>
                  <span v-if="reference.score !== undefined">相关度 {{ reference.score.toFixed(3) }}</span>
                </div>
              </div>
              <button
                class="reference-copy"
                type="button"
                title="复制引用片段"
                @click.stop="handleCopyReference(reference, index)"
              >
                <SvgIcon
                  :name="copiedReferenceKey === referenceKey(reference, index) ? 'check' : 'copy'"
                  :size="13"
                />
              </button>
            </header>
            <p class="reference-content">{{ reference.content }}</p>
          </article>
        </div>
        <div v-else class="knowledge-empty">
          知识库中没有命中可引用片段
        </div>
      </div>
      <div v-else-if="hasJavascriptResult && javascriptExecution" class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          执行结果
        </span>
        <div class="js-result-card" :class="{ error: toolCall.isError }">
          <div class="js-result-grid">
            <div class="js-result-metric">
              <span class="js-metric-label">状态</span>
              <span :class="['js-status-pill', toolCall.isError ? 'error' : 'success']">
                {{ toolCall.isError ? "失败" : "成功" }}
              </span>
            </div>
            <div class="js-result-metric">
              <span class="js-metric-label">日志</span>
              <span class="js-metric-value">{{ javascriptExecution.logs.length }} 条</span>
            </div>
          </div>

          <div class="js-output-block">
            <div class="js-block-title">返回值</div>
            <pre class="js-output-pre">{{ javascriptExecution.result }}</pre>
          </div>

          <div class="js-output-block">
            <div class="js-block-title">日志</div>
            <div v-if="javascriptExecution.logs.length > 0" class="js-log-list">
              <div
                v-for="(log, index) in javascriptExecution.logs"
                :key="`${index}-${log}`"
                class="js-log-line"
              >
                <span class="js-log-index">{{ index + 1 }}</span>
                <span class="js-log-text">{{ log }}</span>
              </div>
            </div>
            <div v-else class="js-empty">无日志输出</div>
          </div>

          <details v-if="javascriptExecution.code" class="js-code-details" @click.stop>
            <summary>查看代码</summary>
            <pre class="js-code-pre" v-html="hljs.highlight(javascriptExecution.code, { language: 'javascript' }).value" />
          </details>
        </div>
      </div>
      <div v-else-if="toolCall.result" class="tool-section">
        <span class="section-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          结果
        </span>
        <pre>{{ JSON.stringify(toolCall.result, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
}

.tool-call-card:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: var(--color-border-hover);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.tool-call-card.expanded {
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 0 0 1px rgba(99,102,241,0.08);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.tool-icon-wrapper {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(99, 102, 241, 0.1);
  border-radius: 6px;
  color: var(--color-accent-light);
}

.tool-icon-wrapper svg {
  width: 12px;
  height: 12px;
}

.tool-name {
  flex: 1;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-family: var(--font-mono);
  font-weight: 500;
}

.tool-status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-weight: 600;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success);
}

.tool-status.error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.tool-status.running {
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-warning);
}

.expand-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.tool-details {
  padding: 0 14px 14px;
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 0;
}

.tool-section {
  margin-top: 12px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  line-height: 1.6;
  border: 1px solid var(--color-border-subtle);
}

.knowledge-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.knowledge-summary span {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.09);
  border: 1px solid rgba(99, 102, 241, 0.16);
}

.knowledge-list {
  display: grid;
  gap: 8px;
}

.knowledge-reference {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
}

.reference-header {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 8px;
}

.reference-index {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.16);
  color: var(--color-accent-light);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.reference-meta {
  min-width: 0;
  flex: 1 1 auto;
}

.reference-title {
  display: inline-block;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.reference-link {
  text-decoration: none;
  transition: color 0.16s ease;
}

.reference-link:hover {
  color: var(--color-accent-light);
}

.reference-subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.reference-copy {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
}

.reference-copy:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.07);
}

.reference-content {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.knowledge-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px dashed var(--color-border-subtle);
  font-size: 12px;
}

.js-result-card {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
}

.js-result-card.error {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(239, 68, 68, 0.055);
}

.js-result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.js-result-metric {
  min-height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.js-metric-label,
.js-block-title {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.js-metric-value {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.js-status-pill {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
}

.js-status-pill.success {
  color: var(--color-success);
  background: rgba(34, 197, 94, 0.12);
}

.js-status-pill.error {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
}

.js-output-block {
  display: grid;
  gap: 6px;
}

.js-output-pre,
.js-code-pre {
  margin: 0;
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.js-log-list {
  display: grid;
  gap: 5px;
}

.js-log-line {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 7px 9px;
  border-radius: 7px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
}

.js-log-index {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.js-log-text {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.js-empty {
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.14);
  border: 1px dashed var(--color-border-subtle);
  font-size: 12px;
}

.js-code-details {
  color: var(--color-text-secondary);
}

.js-code-details summary {
  width: fit-content;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.16s ease;
}

.js-code-details summary:hover {
  color: var(--color-text-primary);
}

.js-code-pre {
  margin-top: 8px;
}

@media (max-width: 640px) {
  .js-result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
