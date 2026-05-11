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
    <!-- Left Sidebar -->
    <aside class="documents-sidebar">
      <div class="sidebar-header">
        <h2>文档</h2>
        <p>管理和检索文档知识库</p>
      </div>

      <div class="search-box">
        <SvgIcon name="search" class="search-icon" :size="16" />
        <input
          v-model="searchQuery"
          class="input-field search-input"
          placeholder="搜索文档原文..."
          @keyup.enter="searchDocuments"
        />
        <button v-if="searchResults.length" class="clear-btn" type="button" title="清除搜索" @click="clearSearch">
          <SvgIcon name="close" :size="12" />
        </button>
      </div>

      <nav class="doc-nav">
        <div class="nav-divider">文档列表</div>
        <button
          v-for="doc in visibleDocuments"
          :key="doc.id"
          class="nav-item doc-nav-item"
          :class="{ active: selectedDoc?.id === doc.id }"
          type="button"
          @click="selectDocument(doc.id)"
        >
          <div class="doc-nav-icon">
            <SvgIcon name="file" :size="16" />
          </div>
          <div>
            <span class="nav-label">{{ doc.title }}</span>
            <span class="nav-desc">{{ doc.source }} · {{ new Date(doc.createdAt).toLocaleString() }}</span>
          </div>
        </button>
        <div v-if="!loading && visibleDocuments.length === 0" class="nav-empty">没有文档</div>
      </nav>

      <div class="sidebar-actions">
        <button class="upload-btn" type="button" @click="fileInput?.click()">
          <SvgIcon name="upload" :size="14" />
          导入文件
        </button>
      </div>
      <input ref="fileInput" class="file-input" type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.pdf,.docx" @change="uploadFile">
    </aside>

    <!-- Right Content -->
    <main class="documents-main">
      <section v-if="selectedDoc" class="detail-panel">
        <div class="detail-header">
          <div class="detail-title-row">
            <div class="detail-icon">
              <SvgIcon name="file" :size="22" />
            </div>
            <div class="detail-title-info">
              <h3 class="detail-title">{{ selectedDoc.title }}</h3>
              <div class="detail-meta">
                <span class="meta-text">{{ selectedDoc.source }}</span>
                <span class="meta-text">{{ new Date(selectedDoc.createdAt).toLocaleString() }}</span>
              </div>
            </div>
          </div>
          <div class="detail-actions">
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
          <h4 class="section-title">切片</h4>
          <div class="chunk-list">
            <article v-for="chunk in selectedChunks" :key="chunk.id" class="chunk-item">
              <strong>#{{ chunk.index + 1 }}</strong>
              <p>{{ chunk.content }}</p>
            </article>
          </div>
        </section>
      </section>

      <section v-else class="empty-state">
        <div class="empty-icon">
          <SvgIcon name="book" :size="24" />
        </div>
        <p class="empty-title">选择或导入一个文档</p>
        <p class="empty-desc">从左侧选择文档，或点击导入按钮添加新文件</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.documents-view {
  height: 100%;
  overflow: hidden;
}

.documents-layout,
.documents-view {
  display: flex;
  height: 100%;
}

/* Left Sidebar */
.documents-sidebar {
  width: 320px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 24px 16px;
}

.sidebar-header {
  margin-bottom: 16px;
  padding: 0 8px;
}

.sidebar-header h2 {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}

.sidebar-header p {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0;
}

/* Search Box */
.search-box {
  position: relative;
  margin-bottom: 12px;
  padding: 0 4px;
}

.search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.input-field.search-input {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 40px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.input-field.search-input:focus {
  border-color: var(--border-default);
}

.input-field.search-input::placeholder {
  color: var(--text-muted);
}

.clear-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
}

.clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* Nav */
.doc-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-divider {
  padding: 12px 8px 6px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.nav-item.active {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-color: var(--border-default);
}

.nav-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nav-label {
  font-weight: var(--weight-bold);
  font-size: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.nav-item.active .nav-desc {
  color: var(--text-secondary);
}

.doc-nav-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 8px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.nav-item.active .doc-nav-icon {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.nav-empty {
  padding: 20px 8px;
  font-size: var(--text-base);
  color: var(--text-muted);
  text-align: center;
}

/* Sidebar Actions */
.sidebar-actions {
  padding: 12px 4px 0;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 9px 0;
  border: 1px dashed var(--border-subtle);
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 0.18s ease;
}

.upload-btn:hover {
  border-color: var(--border-default);
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.file-input {
  display: none;
}

/* Right Content */
.documents-main {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Detail Panel */
.detail-panel {
  max-width: 720px;
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.detail-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-title-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.detail-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.secondary-btn,
.danger-btn {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  font-size: var(--text-base);
  box-sizing: border-box;
  transition: all 0.15s;
}

.secondary-btn {
  color: var(--text-secondary);
  background: var(--bg-card);
}

.secondary-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.danger-btn {
  color: var(--color-danger);
  background: var(--bg-danger);
  border-color: var(--border-danger);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Content Sections */
.section-title {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
  margin: 0 0 12px;
}

.chunks-section {
  margin-top: 24px;
}

.chunk-card,
.chunk-item {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  padding: 12px 14px;
  margin-bottom: 12px;
}

.chunk-card header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: var(--text-base);
}

.chunk-card button {
  border: 0;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.chunk-list {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.chunk-item strong {
  display: block;
  margin-bottom: 5px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.document-content pre,
.chunk-item p,
.chunk-card p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: 1.7;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 0;
  color: var(--text-muted);
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  margin-bottom: 14px;
  color: var(--text-muted);
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: var(--text-base);
  margin: 0;
  color: var(--text-muted);
}

@media (max-width: 960px) {
  .documents-view {
    height: auto;
    min-height: 100dvh;
    flex-direction: column;
  }

  .documents-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    padding: 16px;
    min-height: auto;
  }

  .documents-main {
    padding: 16px;
    overflow: visible;
  }
}
</style>
