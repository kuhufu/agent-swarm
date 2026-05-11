<script lang="ts">
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

interface KnowledgeReference {
  documentId?: string;
  title: string;
  source?: string;
  chunkIndex?: number;
  score?: number;
  content: string;
}

function normalizeKnowledgeReference(value: unknown): KnowledgeReference | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const document = asRecord(raw.document);
  const chunk = asRecord(raw.chunk);
  const title = typeof document?.title === "string" && document.title.trim().length > 0
    ? document.title : "未命名文档";
  const content = typeof chunk?.content === "string" ? chunk.content.trim() : "";
  if (!content) return null;

  return {
    documentId: typeof document?.id === "string" && document.id.trim().length > 0 ? document.id : undefined,
    title,
    source: typeof document?.source === "string" && document.source.trim().length > 0 ? document.source : undefined,
    chunkIndex: typeof chunk?.index === "number" ? chunk.index : undefined,
    score: typeof raw.score === "number" ? raw.score : undefined,
    content,
  };
}

function extractKnowledgeReferences(details: unknown): KnowledgeReference[] | null {
  if (Array.isArray(details)) {
    return details.map(normalizeKnowledgeReference).filter((item): item is KnowledgeReference => item !== null);
  }
  return null;
}

function extractQueryText(args: unknown): string {
  const raw = asRecord(args);
  return typeof raw?.query === "string" ? raw.query : "";
}

export { extractKnowledgeReferences, extractQueryText };
export type { KnowledgeReference };
</script>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import SvgIcon from "../common/SvgIcon.vue";
import SectionLabel from "./SectionLabel.vue";

const props = defineProps<{
  references: KnowledgeReference[];
  queryText: string;
}>();

const copiedReferenceKey = ref<string | null>(null);

function referenceKey(reference: KnowledgeReference, index: number): string {
  return `${reference.documentId ?? reference.title}-${reference.chunkIndex ?? index}-${index}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
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
  <div class="tool-section">
    <SectionLabel icon="check" label="知识库引用" />
    <div class="knowledge-summary">
      <span v-if="queryText">查询：{{ queryText }}</span>
      <span>{{ references.length }} 条引用</span>
    </div>
    <div v-if="references.length > 0" class="knowledge-list">
      <article
        v-for="(reference, index) in references"
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
</template>

<style scoped>
.knowledge-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.knowledge-summary span {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 9999px;
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
}

.knowledge-list {
  display: grid;
  gap: 8px;
}

.knowledge-reference {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
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
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.reference-meta {
  min-width: 0;
  flex: 1 1 auto;
}

.reference-title {
  display: inline-block;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.reference-link {
  text-decoration: none;
  transition: color 0.16s ease;
}

.reference-link:hover {
  color: var(--text-secondary);
}

.reference-subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.4;
}

.reference-copy {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
}

.reference-copy:hover {
  color: var(--text-primary);
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.reference-content {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.knowledge-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px dashed var(--border-subtle);
  font-size: var(--text-sm);
}
</style>
