<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { apiClient } from "../api/client.js";

interface Document {
  id: string;
  title: string;
  source: string;
  content?: string;
  createdAt: number;
}

interface SearchResultItem {
  chunk: { id: string; documentId: string; content: string; index: number };
  document: Document;
  score: number;
}

const documents = ref<Document[]>([]);
const searchResults = ref<SearchResultItem[]>([]);
const loading = ref(false);
const searching = ref(false);
const searchQuery = ref("");
const selectedDoc = ref<Document | null>(null);
const deletingId = ref<string | null>(null);
const loadingDetail = ref(false);
const showPreview = ref(false);
const isEditing = ref(false);
const isNewDoc = ref(false);
const editTitle = ref("");
const editContent = ref("");

const displayDocuments = computed<Document[]>(() => {
  const q = searchQuery.value.trim();
  if (!q) return documents.value;
  // Deduplicate by document ID from search results
  const seen = new Set<string>();
  const docs: Document[] = [];
  for (const r of searchResults.value) {
    if (!seen.has(r.document.id)) {
      seen.add(r.document.id);
      docs.push(r.document);
    }
  }
  return docs;
});

function getMatchSnippet(docId: string): string | null {
  if (!searchQuery.value.trim()) return null;
  const match = searchResults.value.find((r) => r.document.id === docId);
  return match ? match.chunk.content : null;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = q.trim();
  if (!trimmed) {
    searchResults.value = [];
    return;
  }
  searchTimer = setTimeout(() => doSearch(trimmed), 300);
});

onMounted(() => loadDocuments());
onUnmounted(() => { if (searchTimer) clearTimeout(searchTimer); });

async function loadDocuments() {
  loading.value = true;
  try {
    const resp = await apiClient<{ data: Document[] }>("/documents");
    documents.value = resp.data ?? [];
  } finally {
    loading.value = false;
  }
}

async function loadDocumentDetail(id: string): Promise<Document> {
  const resp = await apiClient<{ data: Document }>(`/documents/${id}`);
  return resp.data;
}

async function doSearch(query: string) {
  searching.value = true;
  try {
    const resp = await apiClient<{ data: SearchResultItem[] }>("/documents/search", {
      method: "POST",
      body: JSON.stringify({ query, topK: 20 }),
    });
    searchResults.value = resp.data ?? [];
  } catch {
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
}

function createNewDoc() {
  const tempDoc: Document = {
    id: `__new__${Date.now()}`,
    title: "未命名文档",
    source: "manual",
    content: "",
    createdAt: Date.now(),
  };
  documents.value.unshift(tempDoc);
  selectedDoc.value = tempDoc;
  showPreview.value = true;
  isNewDoc.value = true;
  isEditing.value = true;
  editTitle.value = tempDoc.title;
  editContent.value = "";
}

async function selectDocument(doc: Document) {
  if (selectedDoc.value?.id === doc.id) {
    if (isNewDoc.value) return;
    selectedDoc.value = null;
    showPreview.value = false;
    isEditing.value = false;
    isNewDoc.value = false;
    return;
  }
  if (doc.id.startsWith("__new__")) {
    selectedDoc.value = doc;
    showPreview.value = true;
    isEditing.value = true;
    isNewDoc.value = true;
    editTitle.value = doc.title;
    editContent.value = doc.content ?? "";
    return;
  }
  isEditing.value = false;
  isNewDoc.value = false;
  loadingDetail.value = true;
  try {
    selectedDoc.value = await loadDocumentDetail(doc.id);
    showPreview.value = true;
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  } finally {
    loadingDetail.value = false;
  }
}

function closePreview() {
  if (isNewDoc.value) {
    documents.value = documents.value.filter(d => d.id !== selectedDoc.value?.id);
  }
  showPreview.value = false;
  selectedDoc.value = null;
  isEditing.value = false;
  isNewDoc.value = false;
}

async function startEdit() {
  if (!selectedDoc.value) return;
  editTitle.value = selectedDoc.value.title;
  editContent.value = selectedDoc.value.content ?? "";
  isEditing.value = true;
  isNewDoc.value = false;
}

async function selectAndEdit(doc: Document) {
  if (doc.id.startsWith("__new__")) {
    selectedDoc.value = doc;
    showPreview.value = true;
    isEditing.value = true;
    isNewDoc.value = true;
    editTitle.value = doc.title;
    editContent.value = doc.content ?? "";
    return;
  }
  isEditing.value = false;
  isNewDoc.value = false;
  loadingDetail.value = true;
  try {
    selectedDoc.value = await loadDocumentDetail(doc.id);
    showPreview.value = true;
    editTitle.value = selectedDoc.value.title;
    editContent.value = selectedDoc.value.content ?? "";
    isEditing.value = true;
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  } finally {
    loadingDetail.value = false;
  }
}

function cancelEdit() {
  if (isNewDoc.value) {
    documents.value = documents.value.filter(d => d.id !== selectedDoc.value?.id);
    showPreview.value = false;
    selectedDoc.value = null;
    isNewDoc.value = false;
  }
  isEditing.value = false;
  editTitle.value = "";
  editContent.value = "";
}

async function saveEdit() {
  if (!selectedDoc.value) return;
  if (!editTitle.value.trim() || !editContent.value.trim()) {
    await MessagePlugin.warning("标题和内容不能为空");
    return;
  }
  loading.value = true;
  try {
    if (isNewDoc.value) {
      await apiClient("/documents/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: editTitle.value.trim(),
          content: editContent.value,
        }),
      });
      await MessagePlugin.success("文档已创建");
      isNewDoc.value = false;
      await loadDocuments();
      // Select the newly created doc
      const created = documents.value[0];
      if (created) {
        selectedDoc.value = await loadDocumentDetail(created.id);
      }
    } else {
      await apiClient(`/documents/${selectedDoc.value.id}`, {
        method: "PUT",
        body: JSON.stringify({
          filename: editTitle.value.trim(),
          content: editContent.value,
        }),
      });
      await MessagePlugin.success("文档已更新");
      selectedDoc.value = await loadDocumentDetail(selectedDoc.value.id);
      await loadDocuments();
    }
    isEditing.value = false;
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function handleDelete(id: string) {
  if (id.startsWith("__new__")) {
    documents.value = documents.value.filter(d => d.id !== id);
    if (selectedDoc.value?.id === id) {
      selectedDoc.value = null;
      showPreview.value = false;
      isEditing.value = false;
      isNewDoc.value = false;
    }
    return;
  }
  deletingId.value = id;
  try {
    await apiClient(`/documents/${id}`, { method: "DELETE" });
    await MessagePlugin.success("文档已删除");
    if (selectedDoc.value?.id === id) {
      selectedDoc.value = null;
      showPreview.value = false;
      isEditing.value = false;
      isNewDoc.value = false;
    }
    await loadDocuments();
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  } finally {
    deletingId.value = null;
  }
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = diff / 3_600_000;
  if (hours < 24) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (hours < 48) return "昨天";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function highlightMatch(text: string, query: string): string {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}
</script>

<template>
  <div class="documents-view">
    <!-- Header -->
    <header class="view-header">
      <div class="header-left">
        <h1 class="section-title">知识库</h1>
        <span class="count-badge" v-if="searchQuery">
          搜索到 {{ displayDocuments.length }} 篇
        </span>
        <span class="count-badge" v-else-if="documents.length">
          {{ documents.length }} 篇文档
        </span>
      </div>
      <div class="header-actions">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="搜索文档内容..."
          />
          <span v-if="searching" class="search-spinner" />
        </div>
        <button class="btn-primary" @click="createNewDoc">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建文档
        </button>
      </div>
    </header>

    <!-- Document list -->
    <div v-if="loading && !documents.length" class="loading-state">
      <div class="loading-spinner" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!documents.length" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <p class="empty-title">知识库为空</p>
      <p class="empty-desc">新建文档，为 Agent 提供领域知识</p>
      <button class="btn-primary upload-cta" @click="createNewDoc">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新建第一篇文档
      </button>
    </div>

    <div v-else class="doc-layout">
      <!-- Document list -->
      <div class="doc-list" :class="{ 'with-preview': showPreview }">
        <div
          v-for="doc in displayDocuments"
          :key="doc.id"
          class="card doc-card"
          :class="{ selected: selectedDoc?.id === doc.id }"
          @click="selectDocument(doc)"
        >
          <div class="doc-card-header">
            <div class="doc-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div class="doc-title-row">
              <h3 class="doc-title">{{ doc.title }}</h3>
              <span class="badge badge-accent">{{ doc.source }}</span>
            </div>
          </div>

          <!-- Search result snippet -->
          <div v-if="searchQuery && getMatchSnippet(doc.id)" class="doc-snippet">
            <pre class="doc-content" v-html="highlightMatch(truncate(getMatchSnippet(doc.id)!, 300), searchQuery)" />
          </div>

          <div class="doc-card-footer">
            <span class="doc-date">{{ formatDate(doc.createdAt) }}</span>
            <div class="doc-actions">
              <button
                class="btn-icon"
                @click.stop="selectAndEdit(doc)"
                :title="'编辑文档'"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button
                class="btn-icon danger"
                :disabled="deletingId === doc.id"
                @click.stop="handleDelete(doc.id)"
                :title="'删除文档'"
              >
                <svg v-if="deletingId !== doc.id" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span v-else class="spinner-mini" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="searchQuery && !displayDocuments.length" class="empty-state small">
          <p class="empty-title">{{ searching ? "搜索中..." : "没有匹配的文档" }}</p>
          <p class="empty-desc">试试换个关键词</p>
        </div>
      </div>

      <!-- Document preview panel -->
      <transition name="doc-slide">
        <div v-if="showPreview && selectedDoc" class="doc-panel card">
          <div class="doc-header">
            <div class="doc-title-area">
              <div class="doc-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div v-if="!isEditing" class="doc-title-text">
                <h2 class="doc-panel-title">{{ selectedDoc.title }}</h2>
                <span class="doc-meta">
                  <span class="badge badge-accent">{{ selectedDoc.source }}</span>
                  <span class="doc-date">{{ formatDate(selectedDoc.createdAt) }}</span>
                </span>
              </div>
              <div v-else class="doc-title-text">
                <input
                  v-model="editTitle"
                  class="edit-title-input"
                  placeholder="文档标题"
                />
                <span class="doc-meta">
                  <span class="badge badge-accent">{{ selectedDoc.source }}</span>
                  <span class="doc-date">{{ formatDate(selectedDoc.createdAt) }}</span>
                </span>
              </div>
            </div>
            <div class="doc-actions">
              <template v-if="isEditing">
                <button class="btn-icon" @click="cancelEdit" title="取消编辑">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <button class="btn-icon save-btn" :disabled="loading" @click="saveEdit" title="保存">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </template>
              <template v-else>
                <button class="btn-icon" @click="startEdit" title="编辑">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              </template>
              <button class="btn-icon" @click="closePreview" title="关闭">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="doc-body">
            <div v-if="loadingDetail" class="doc-loading">
              <div class="loading-spinner" />
              <p>加载中...</p>
            </div>
            <textarea
              v-else-if="isEditing"
              v-model="editContent"
              class="doc-textarea"
              placeholder="文档内容"
              :disabled="loading"
            ></textarea>
            <textarea
              v-else-if="selectedDoc.content"
              class="doc-textarea readonly"
              :value="selectedDoc.content"
              readonly
            ></textarea>
            <div v-else class="doc-empty">
              <p>暂无文档内容</p>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.documents-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px 32px;
}

/* ── Header ── */
.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left .section-title {
  margin-bottom: 0;
}

.count-badge {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--glass-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  padding: 3px 10px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── Search ── */
.search-box {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.search-input {
  width: 240px;
  padding: 8px 14px 8px 36px;
  background: var(--input-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

.search-spinner {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-subtle);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* ── Upload CTA ── */
.upload-cta {
  margin-top: 8px;
}

/* ── Loading ── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 0;
  color: var(--color-text-muted);
  font-size: 13px;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border-subtle);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Empty state ── */
.empty-state.small {
  padding: 40px 0;
}

.empty-state.small .empty-title {
  font-size: 14px;
}

.empty-state.small .empty-desc {
  font-size: 12px;
}

/* ── Document layout ── */
.doc-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.doc-list {
  flex: 0 0 420px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-content: start;
  overflow-y: auto;
  padding-right: 4px;
}

.doc-list.with-preview {
  grid-template-columns: 1fr;
}

.doc-card {
  padding: 16px 20px;
  cursor: pointer;
  user-select: none;
}

.doc-card:hover {
  border-color: var(--color-border-hover);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.doc-card.selected {
  border-color: rgba(99, 102, 241, 0.25);
  background: rgba(99, 102, 241, 0.06);
  box-shadow: inset 2px 0 0 var(--color-accent);
}

.doc-card-header {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.doc-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--empty-icon-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.doc-icon svg {
  width: 18px;
  height: 18px;
}

.doc-title-row {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.doc-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-title-row .badge {
  align-self: flex-start;
}

/* ── Document snippet (search) ── */
.doc-snippet {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-subtle);
}

.doc-content {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.doc-content :deep(mark) {
  background: rgba(251, 191, 36, 0.25);
  color: #fde68a;
  border-radius: 2px;
  padding: 0 1px;
}

/* ── Doc panel ── */
.doc-panel {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  min-height: 0;
}

.doc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
  height: 76px;
  box-sizing: border-box;
}

.doc-title-area {
  display: flex;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.doc-title-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.doc-title-text h2,
.doc-title-text input {
  margin: 0 !important;
}

.doc-panel-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.375;
  color: var(--color-text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 12px;
}

.doc-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  min-height: 0;
  overflow: hidden;
}

.doc-textarea {
  width: 100%;
  height: 100%;
  min-height: 200px;
  margin: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  white-space: pre-wrap;
  word-break: break-word;
}

.doc-textarea.readonly {
  cursor: default;
  color: var(--color-text-secondary);
}

.edit-title-input {
  width: 100%;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.375;
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  outline: none;
  margin: 0;
  height: auto;
}

.edit-title-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.save-btn {
  color: var(--color-accent);
}

.save-btn:hover {
  background: rgba(99, 102, 241, 0.1);
}

.doc-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 0;
  color: var(--color-text-muted);
  font-size: 13px;
  gap: 12px;
}

.doc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

/* ── Card footer ── */
.doc-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-subtle);
}

.doc-date {
  font-size: 11px;
  color: var(--color-text-muted);
}

.doc-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-icon:hover {
  background: var(--btn-secondary-bg);
  color: var(--color-text-primary);
}

.btn-icon.danger:hover {
  background: var(--btn-danger-bg);
  color: var(--color-danger);
}

.btn-icon svg {
  width: 14px;
  height: 14px;
}

.btn-icon:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.spinner-mini {
  display: block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-subtle);
  border-top-color: var(--color-danger);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ── Transitions ── */
.doc-slide-enter-active,
.doc-slide-leave-active {
  transition: all 0.3s ease;
}

.doc-slide-enter-from,
.doc-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .documents-view {
    padding: 16px;
  }

  .view-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
  }

  .search-input {
    width: 100%;
    flex: 1;
  }

  .doc-layout {
    flex-direction: column;
  }

  .doc-list {
    flex: none;
    grid-template-columns: 1fr;
    max-height: none;
    width: 100%;
  }

  .doc-list.with-preview {
    max-height: 40vh;
  }

  .doc-panel {
    flex: none;
    min-height: 40vh;
  }
}
</style>
