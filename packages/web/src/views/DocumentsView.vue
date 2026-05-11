<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiClient } from "../api/client.js";
import SvgIcon from "../components/common/SvgIcon.vue";
import { showError, showSuccess } from "../utils/ui-feedback.js";

interface DocumentItem {
  id: string;
  title: string;
  source: string;
  content?: string;
  createdAt: number;
}

interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
}

interface SearchResultItem {
  document: DocumentItem;
  chunk: DocumentChunk;
  score: number;
}

interface WikiPage {
  id: string;
  title: string;
}

const route = useRoute();
const router = useRouter();

const documents = ref<DocumentItem[]>([]);
const selectedDoc = ref<DocumentItem | null>(null);
const selectedChunks = ref<DocumentChunk[]>([]);
const routeChunk = ref<DocumentChunk | null>(null);
const searchQuery = ref("");
const searchResults = ref<SearchResultItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const generatingWiki = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const visibleDocuments = computed(() => {
  if (searchResults.value.length === 0) return documents.value;
  const seen = new Set<string>();
  const result: DocumentItem[] = [];
  for (const item of searchResults.value) {
    if (seen.has(item.document.id)) continue;
    seen.add(item.document.id);
    result.push(item.document);
  }
  return result;
});

onMounted(async () => {
  await loadDocuments();
  await openRouteDocument();
});

watch(() => [route.query.doc, route.query.chunk], () => {
  void openRouteDocument();
});

async function loadDocuments() {
  loading.value = true;
  try {
    const response = await apiClient<{ data: DocumentItem[] }>("/documents");
    documents.value = response.data ?? [];
    if (!selectedDoc.value && !route.query.doc && documents.value[0]) {
      await selectDocument(documents.value[0].id);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载文档失败");
  } finally {
    loading.value = false;
  }
}

async function openRouteDocument() {
  const docId = typeof route.query.doc === "string" ? route.query.doc : "";
  if (!docId) return;
  await selectDocument(docId, false);
}

async function selectDocument(id: string, syncRoute = true) {
  try {
    const response = await apiClient<{ data: DocumentItem }>(`/documents/${id}`);
    selectedDoc.value = response.data;
    await loadChunks(id);
    const chunkIndex = routeChunkIndex();
    routeChunk.value = typeof chunkIndex === "number"
      ? selectedChunks.value.find((chunk) => chunk.index === chunkIndex) ?? null
      : null;
    if (syncRoute) {
      void router.replace({ name: "documents", query: { doc: id } });
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "打开文档失败");
  }
}

async function loadChunks(documentId: string) {
  const response = await apiClient<{ data: DocumentChunk[] }>(`/documents/${documentId}/chunks`);
  selectedChunks.value = response.data ?? [];
}

function routeChunkIndex(): number | null {
  const raw = route.query.chunk;
  if (typeof raw !== "string") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function searchDocuments() {
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    return;
  }
  loading.value = true;
  try {
    const response = await apiClient<{ data: SearchResultItem[] }>("/documents/search", {
      method: "POST",
      body: JSON.stringify({ query, topK: 20 }),
    });
    searchResults.value = response.data ?? [];
    const firstMatch = searchResults.value[0];
    if (firstMatch) {
      await selectDocument(firstMatch.document.id, false);
      routeChunk.value = firstMatch.chunk;
      void router.replace({
        name: "documents",
        query: { doc: firstMatch.document.id, chunk: firstMatch.chunk.index },
      });
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "搜索文档失败");
  } finally {
    loading.value = false;
  }
}

function clearSearch() {
  searchQuery.value = "";
  searchResults.value = [];
}

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await apiClient<{ data: { id: string } }>("/documents/upload", {
      method: "POST",
      body: form,
    });
    await loadDocuments();
    await selectDocument(response.data.id);
    showSuccess("文件已导入");
  } catch (error) {
    showError(error instanceof Error ? error.message : "导入文件失败");
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

async function deleteDocument() {
  if (!selectedDoc.value) return;
  if (!window.confirm(`删除文档“${selectedDoc.value.title}”？`)) return;
  try {
    await apiClient(`/documents/${selectedDoc.value.id}`, { method: "DELETE" });
    selectedDoc.value = null;
    selectedChunks.value = [];
    routeChunk.value = null;
    void router.replace({ name: "documents", query: {} });
    await loadDocuments();
    showSuccess("文档已删除");
  } catch (error) {
    showError(error instanceof Error ? error.message : "删除文档失败");
  }
}

async function generateWikiFromDocument() {
  if (!selectedDoc.value || generatingWiki.value) return;
  generatingWiki.value = true;
  try {
    const response = await apiClient<{ data: { pages: WikiPage[]; generatedBy: string } }>(
      `/wiki/ingest-document/${selectedDoc.value.id}`,
      { method: "POST" },
    );
    const firstPage = response.data.pages[0];
    if (firstPage) {
      void router.push({ name: "wiki", query: { wiki: firstPage.id, doc: selectedDoc.value.id } });
    }
    showSuccess(response.data.generatedBy === "llm" ? "已生成 Wiki 页面" : "已使用基础模式生成 Wiki 页面");
  } catch (error) {
    showError(error instanceof Error ? error.message : "生成 Wiki 失败");
  } finally {
    generatingWiki.value = false;
  }
}
</script>

<template>
  <div class="documents-view">
    <aside class="documents-sidebar">
      <div class="sidebar-header">
        <div>
          <h1>文档</h1>
          <p>{{ documents.length }} 个源文件</p>
        </div>
        <button class="icon-btn" type="button" title="导入文件" @click="fileInput?.click()">
          <SvgIcon name="upload" :size="16" />
        </button>
        <input ref="fileInput" class="file-input" type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.pdf,.docx" @change="uploadFile">
      </div>

      <div class="search-row">
        <input v-model="searchQuery" class="search-input" type="search" placeholder="搜索文档原文" @keyup.enter="searchDocuments">
        <button class="icon-btn" type="button" title="搜索" @click="searchDocuments">
          <SvgIcon name="search" :size="15" />
        </button>
        <button v-if="searchResults.length" class="icon-btn muted" type="button" title="清除搜索" @click="clearSearch">
          <SvgIcon name="close" :size="15" />
        </button>
      </div>

      <div class="document-list">
        <button
          v-for="doc in visibleDocuments"
          :key="doc.id"
          class="document-list-item"
          :class="{ active: selectedDoc?.id === doc.id }"
          type="button"
          @click="selectDocument(doc.id)"
        >
          <span class="document-title">{{ doc.title }}</span>
          <span class="document-meta">{{ doc.source }} · {{ new Date(doc.createdAt).toLocaleString() }}</span>
        </button>
        <div v-if="!loading && visibleDocuments.length === 0" class="empty-list">没有文档</div>
      </div>
    </aside>

    <main class="documents-main">
      <section v-if="selectedDoc" class="document-detail">
        <div class="detail-toolbar">
          <div>
            <h2>{{ selectedDoc.title }}</h2>
            <p>{{ selectedDoc.source }} · {{ new Date(selectedDoc.createdAt).toLocaleString() }}</p>
          </div>
          <div class="toolbar-actions">
            <button class="secondary-btn" type="button" :disabled="generatingWiki" @click="generateWikiFromDocument">
              <SvgIcon name="book" :size="14" />
              {{ generatingWiki ? "生成中..." : "生成 Wiki" }}
            </button>
            <button class="danger-btn" type="button" @click="deleteDocument">
              <SvgIcon name="trash" :size="14" />
              删除
            </button>
          </div>
        </div>

        <article v-if="routeChunk" class="chunk-card">
          <header>
            <strong>命中片段 #{{ routeChunk.index + 1 }}</strong>
            <button type="button" @click="routeChunk = null">清除</button>
          </header>
          <p>{{ routeChunk.content }}</p>
        </article>

        <article class="document-content">
          <pre>{{ selectedDoc.content }}</pre>
        </article>

        <section class="chunks-section">
          <h3>切片</h3>
          <div class="chunk-list">
            <article v-for="chunk in selectedChunks" :key="chunk.id" class="chunk-item">
              <strong>#{{ chunk.index + 1 }}</strong>
              <p>{{ chunk.content }}</p>
            </article>
          </div>
        </section>
      </section>

      <section v-else class="document-detail empty-detail">
        <SvgIcon name="book" :size="32" />
        <h2>选择或导入一个文档</h2>
      </section>
    </main>
  </div>
</template>

<style scoped>
.documents-view {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 18px;
  padding: 24px;
  color: var(--text-primary);
  overflow: hidden;
  box-sizing: border-box;
}

.documents-sidebar,
.document-detail {
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
}

.documents-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.sidebar-header,
.detail-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 20px;
}

h2 {
  font-size: 18px;
}

h3 {
  color: var(--text-secondary);
  font-size: 13px;
}

.sidebar-header p,
.detail-toolbar p {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 13px;
}

.search-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.search-row .search-input {
  flex: 1;
  min-width: 0;
}

.search-row .icon-btn {
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.document-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  margin-top: 14px;
  overflow-y: auto;
}

.document-list-item {
  display: grid;
  gap: 4px;
  padding: 11px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  text-align: left;
  cursor: pointer;
}

.document-list-item.active {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.12);
}

.document-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.document-meta {
  color: var(--text-muted);
  font-size: 12px;
}

.documents-main {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 18px;
  overflow: hidden;
}

.document-detail {
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.document-content,
.chunk-card,
.chunks-section {
  margin-top: 18px;
}

.document-content pre,
.chunk-item p,
.chunk-card p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.chunk-card,
.chunk-item,
.empty-list {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.16);
  padding: 10px 12px;
}

.chunk-card header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.chunk-card button {
  border: 0;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.chunk-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.chunk-item strong {
  display: block;
  margin-bottom: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.empty-detail {
  min-height: 320px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--text-muted);
}

.file-input {
  display: none;
}

.icon-btn,
.secondary-btn,
.danger-btn {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  font-size: 13px;
  box-sizing: border-box;
}

.icon-btn {
  width: 36px;
  padding: 0;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
}

.icon-btn.muted {
  color: var(--text-muted);
}

.secondary-btn {
  padding: 0 12px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.045);
}

.danger-btn {
  padding: 0 12px;
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.18);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 960px) {
  .documents-view {
    height: auto;
    min-height: 100dvh;
    grid-template-columns: 1fr;
    padding: 16px;
    overflow: visible;
  }

  .documents-sidebar,
  .documents-main,
  .document-detail {
    overflow: visible;
  }

}
</style>
