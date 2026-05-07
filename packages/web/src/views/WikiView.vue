<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiClient } from "../api/client.js";
import SvgIcon from "../components/common/SvgIcon.vue";
import { showError, showSuccess } from "../utils/ui-feedback.js";

interface WikiClaim {
  id?: string;
  text: string;
  sourceDocumentId?: string;
  sourceChunkIndex?: number;
  confidence?: number;
}

interface WikiLink {
  id?: string;
  toTitle: string;
  relation: string;
}

interface WikiPage {
  id: string;
  title: string;
  summary: string;
  content: string;
  aliases: string[];
  tags: string[];
  status: "draft" | "active" | "stale";
  sourceDocumentIds: string[];
  claims?: WikiClaim[];
  links?: WikiLink[];
  createdAt: number;
  updatedAt: number;
}

interface WikiSearchResult {
  page: WikiPage;
  claims: WikiClaim[];
  score: number;
}

interface SourceDocument {
  id: string;
  title: string;
  source: string;
  content?: string;
  createdAt: number;
}

const route = useRoute();
const router = useRouter();

const pages = ref<WikiPage[]>([]);
const selectedPage = ref<WikiPage | null>(null);
const sourceDocuments = ref<SourceDocument[]>([]);
const selectedSourceDocument = ref<SourceDocument | null>(null);
const searchQuery = ref("");
const searchResults = ref<WikiSearchResult[]>([]);
const loading = ref(false);
const saving = ref(false);
const regenerating = ref(false);
const editing = ref(false);
const draft = ref({
  title: "",
  summary: "",
  content: "",
  aliases: "",
  tags: "",
});

const visiblePages = computed(() => {
  if (searchResults.value.length > 0) {
    return searchResults.value.map((result) => result.page);
  }
  return pages.value;
});

const selectedClaims = computed(() => selectedPage.value?.claims ?? []);
const selectedLinks = computed(() => selectedPage.value?.links ?? []);
const selectedTags = computed(() => selectedPage.value?.tags ?? []);
const selectedAliases = computed(() => selectedPage.value?.aliases ?? []);
const sourceById = computed(() => {
  const map = new Map<string, SourceDocument>();
  for (const source of sourceDocuments.value) {
    map.set(source.id, source);
  }
  return map;
});

onMounted(async () => {
  await loadPages();
  await openRouteTarget();
});

watch(() => [route.query.wiki, route.query.doc], () => {
  void openRouteTarget();
});

async function loadPages() {
  loading.value = true;
  try {
    const response = await apiClient<{ data: WikiPage[] }>("/wiki/pages");
    pages.value = response.data ?? [];
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载 Wiki 失败");
  } finally {
    loading.value = false;
  }
}

async function openRouteTarget() {
  const wikiId = typeof route.query.wiki === "string" ? route.query.wiki : "";
  const docId = typeof route.query.doc === "string" ? route.query.doc : "";
  if (wikiId) {
    await selectPage(wikiId, false, docId || undefined);
    return;
  }
  if (docId) {
    await openDirectSourceDocument(docId, false);
    return;
  }
  if (!selectedPage.value && !selectedSourceDocument.value && pages.value[0]) {
    await selectPage(pages.value[0].id);
  }
}

async function selectPage(id: string, syncRoute = true, sourceDocumentId?: string) {
  try {
    const response = await apiClient<{ data: WikiPage }>(`/wiki/pages/${id}`);
    selectedPage.value = response.data;
    await loadSourceDocuments(response.data);
    if (sourceDocumentId) {
      selectedSourceDocument.value = sourceDocuments.value.find((source) => source.id === sourceDocumentId) ?? null;
    }
    editing.value = false;
    fillDraft(response.data);
    if (syncRoute) {
      void router.replace({ name: "wiki", query: { wiki: id } });
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "打开 Wiki 页面失败");
  }
}

async function openDirectSourceDocument(sourceDocumentId: string, syncRoute = true) {
  try {
    const response = await apiClient<{ data: SourceDocument }>(`/documents/${sourceDocumentId}`);
    selectedPage.value = null;
    sourceDocuments.value = [response.data];
    selectedSourceDocument.value = response.data;
    editing.value = false;
    if (syncRoute) {
      void router.replace({ name: "documents", query: { doc: sourceDocumentId } });
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "打开来源资料失败");
  }
}

function fillDraft(page: WikiPage) {
  draft.value = {
    title: page.title,
    summary: page.summary,
    content: page.content,
    aliases: page.aliases.join(", "),
    tags: page.tags.join(", "),
  };
}

async function loadSourceDocuments(page: WikiPage) {
  selectedSourceDocument.value = null;
  if (page.sourceDocumentIds.length === 0) {
    sourceDocuments.value = [];
    return;
  }

  const results = await Promise.all(page.sourceDocumentIds.map(async (sourceId) => {
    try {
      const response = await apiClient<{ data: SourceDocument }>(`/documents/${sourceId}`);
      return response.data;
    } catch {
      return null;
    }
  }));
  sourceDocuments.value = results.filter((item): item is SourceDocument => item !== null);
}

async function searchWiki() {
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    return;
  }
  loading.value = true;
  try {
    const response = await apiClient<{ data: WikiSearchResult[] }>("/wiki/search", {
      method: "POST",
      body: JSON.stringify({ query, topK: 20 }),
    });
    searchResults.value = response.data ?? [];
    if (searchResults.value[0]) {
      await selectPage(searchResults.value[0].page.id);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "搜索 Wiki 失败");
  } finally {
    loading.value = false;
  }
}

function clearSearch() {
  searchQuery.value = "";
  searchResults.value = [];
}

function startCreate() {
  selectedPage.value = null;
  selectedSourceDocument.value = null;
  sourceDocuments.value = [];
  editing.value = true;
  draft.value = { title: "", summary: "", content: "", aliases: "", tags: "" };
}

function openDocumentsTab() {
  void router.push({ name: "documents" });
}

function openSourceFromPage(source: SourceDocument) {
  selectedSourceDocument.value = source;
  if (selectedPage.value) {
    void router.replace({ name: "wiki", query: { wiki: selectedPage.value.id, doc: source.id } });
  }
}

function openClaimSource(sourceDocumentId: string) {
  const source = sourceById.value.get(sourceDocumentId);
  if (!source) return;
  openSourceFromPage(source);
}

async function showDefaultWiki() {
  selectedSourceDocument.value = null;
  sourceDocuments.value = [];
  if (pages.value[0]) {
    await selectPage(pages.value[0].id);
    return;
  }
  void router.replace({ name: "wiki", query: {} });
}

function startEdit() {
  if (!selectedPage.value) return;
  fillDraft(selectedPage.value);
  editing.value = true;
}

async function savePage() {
  const payload = {
    title: draft.value.title,
    summary: draft.value.summary,
    content: draft.value.content,
    aliases: splitCsv(draft.value.aliases),
    tags: splitCsv(draft.value.tags),
  };
  saving.value = true;
  try {
    if (selectedPage.value) {
      const response = await apiClient<{ data: WikiPage }>(`/wiki/pages/${selectedPage.value.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      selectedPage.value = response.data;
    } else {
      const response = await apiClient<{ data: WikiPage }>("/wiki/pages", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      selectedPage.value = response.data;
    }
    editing.value = false;
    await loadPages();
    if (selectedPage.value) {
      await selectPage(selectedPage.value.id);
    }
    showSuccess("Wiki 页面已保存");
  } catch (error) {
    showError(error instanceof Error ? error.message : "保存 Wiki 页面失败");
  } finally {
    saving.value = false;
  }
}

async function deletePage() {
  if (!selectedPage.value) return;
  if (!window.confirm(`删除 Wiki 页面“${selectedPage.value.title}”？`)) return;
  const pageId = selectedPage.value.id;
  try {
    await apiClient(`/wiki/pages/${pageId}`, { method: "DELETE" });
    selectedPage.value = null;
    await loadPages();
    showSuccess("Wiki 页面已删除");
  } catch (error) {
    showError(error instanceof Error ? error.message : "删除 Wiki 页面失败");
  }
}

async function regeneratePage() {
  if (!selectedPage.value || regenerating.value) return;
  regenerating.value = true;
  try {
    const response = await apiClient<{ data: { page: WikiPage; generatedBy: string } }>(
      `/wiki/pages/${selectedPage.value.id}/regenerate`,
      { method: "POST" },
    );
    selectedPage.value = response.data.page;
    await loadSourceDocuments(response.data.page);
    fillDraft(response.data.page);
    await loadPages();
    await selectPage(response.data.page.id);
    showSuccess(response.data.generatedBy === "llm" ? "Wiki 页面已重新生成" : "已使用基础模式刷新 Wiki 页面");
  } catch (error) {
    showError(error instanceof Error ? error.message : "重新生成 Wiki 页面失败");
  } finally {
    regenerating.value = false;
  }
}

function splitCsv(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function sourceTitle(sourceDocumentId: string): string {
  return sourceById.value.get(sourceDocumentId)?.title ?? sourceDocumentId.slice(0, 8);
}

function sourcePreview(source: SourceDocument): string {
  const content = source.content?.trim() ?? "";
  return content.length > 180 ? `${content.slice(0, 180)}...` : content;
}
</script>

<template>
  <div class="wiki-view">
    <aside class="wiki-sidebar">
      <div class="sidebar-header">
        <div>
          <h1>LLM Wiki</h1>
          <p>{{ pages.length }} 个知识页面</p>
        </div>
        <button class="icon-btn" type="button" title="新建页面" @click="startCreate">
          <SvgIcon name="plus" :size="16" />
        </button>
      </div>

      <div class="search-row">
        <input
          v-model="searchQuery"
          class="search-input"
          type="search"
          placeholder="搜索概念、标签或问题"
          @keyup.enter="searchWiki"
        >
        <button class="icon-btn" type="button" title="搜索" @click="searchWiki">
          <SvgIcon name="search" :size="15" />
        </button>
        <button v-if="searchResults.length" class="icon-btn muted" type="button" title="清除搜索" @click="clearSearch">
          <SvgIcon name="close" :size="15" />
        </button>
      </div>

      <div class="page-list">
        <button
          v-for="page in visiblePages"
          :key="page.id"
          class="page-list-item"
          :class="{ active: selectedPage?.id === page.id }"
          type="button"
          @click="selectPage(page.id)"
        >
          <span class="page-title">{{ page.title }}</span>
          <span class="page-summary">{{ page.summary }}</span>
        </button>
        <div v-if="!loading && visiblePages.length === 0" class="empty-list">
          没有 Wiki 页面
        </div>
      </div>
    </aside>

    <main class="wiki-main">
      <section class="ingest-panel">
        <div class="ingest-copy">
          <h2>从文档生成 Wiki</h2>
          <p>先在文档中管理来源文件，再从文档详情生成可编辑的知识页面、要点和来源引用。</p>
        </div>
        <div class="ingest-actions">
          <button class="secondary-btn" type="button" @click="openDocumentsTab">
            <SvgIcon name="book" :size="15" />
            打开文档
          </button>
        </div>
      </section>

      <section v-if="editing" class="editor-panel">
        <div class="detail-toolbar">
          <h2>{{ selectedPage ? "编辑页面" : "新建页面" }}</h2>
          <div class="toolbar-actions">
            <button class="secondary-btn" type="button" @click="editing = false">取消</button>
            <button class="primary-btn" type="button" :disabled="saving" @click="savePage">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>
        <label class="field-label">标题</label>
        <input v-model="draft.title" class="text-input" type="text">
        <label class="field-label">摘要</label>
        <textarea v-model="draft.summary" class="summary-textarea" />
        <label class="field-label">正文</label>
        <textarea v-model="draft.content" class="content-textarea" />
        <label class="field-label">别名</label>
        <input v-model="draft.aliases" class="text-input" type="text" placeholder="用逗号分隔">
        <label class="field-label">标签</label>
        <input v-model="draft.tags" class="text-input" type="text" placeholder="用逗号分隔">
      </section>

      <section v-else-if="selectedPage" class="detail-panel">
        <div class="detail-toolbar">
          <div>
            <h2>{{ selectedPage.title }}</h2>
            <p>{{ selectedPage.summary }}</p>
          </div>
          <div class="toolbar-actions">
            <button
              class="secondary-btn"
              type="button"
              :disabled="regenerating || selectedPage.sourceDocumentIds.length === 0"
              @click="regeneratePage"
            >
              <SvgIcon name="refresh" :size="14" />
              {{ regenerating ? "生成中..." : "重新生成" }}
            </button>
            <button class="secondary-btn" type="button" @click="startEdit">
              <SvgIcon name="edit" :size="14" />
              编辑
            </button>
            <button class="danger-btn" type="button" @click="deletePage">
              <SvgIcon name="trash" :size="14" />
              删除
            </button>
          </div>
        </div>

        <div v-if="selectedTags.length || selectedAliases.length" class="meta-row">
          <span v-for="tag in selectedTags" :key="`tag-${tag}`" class="tag">{{ tag }}</span>
          <span v-for="alias in selectedAliases" :key="`alias-${alias}`" class="alias">{{ alias }}</span>
        </div>

        <article class="wiki-content">
          <pre>{{ selectedPage.content }}</pre>
        </article>

        <section class="evidence-section">
          <h3>支撑要点</h3>
          <div v-if="selectedClaims.length" class="claim-list">
            <div v-for="claim in selectedClaims" :key="claim.id ?? claim.text" class="claim-item">
              <p>{{ claim.text }}</p>
              <button
                v-if="claim.sourceDocumentId"
                class="claim-source"
                type="button"
                @click="openClaimSource(claim.sourceDocumentId)"
              >
                来源 {{ sourceTitle(claim.sourceDocumentId) }}
              </button>
            </div>
          </div>
          <div v-else class="empty-block">暂无支撑要点</div>
        </section>

        <section class="evidence-section">
          <h3>来源资料</h3>
          <div v-if="sourceDocuments.length" class="source-list">
            <button
              v-for="source in sourceDocuments"
              :key="source.id"
              class="source-item"
              :class="{ active: selectedSourceDocument?.id === source.id }"
              type="button"
              @click="openSourceFromPage(source)"
            >
              <span class="source-title">{{ source.title }}</span>
              <span class="source-meta">{{ source.source }} · {{ new Date(source.createdAt).toLocaleString() }}</span>
              <span class="source-preview">{{ sourcePreview(source) }}</span>
            </button>
          </div>
          <div v-else class="empty-block">暂无可查看来源资料</div>
          <article v-if="selectedSourceDocument" class="source-content">
            <header>
              <strong>{{ selectedSourceDocument.title }}</strong>
              <button class="source-close" type="button" @click="selectedSourceDocument = null">收起</button>
            </header>
            <pre>{{ selectedSourceDocument.content }}</pre>
          </article>
        </section>

        <section class="evidence-section">
          <h3>关联页面</h3>
          <div v-if="selectedLinks.length" class="link-list">
            <span v-for="link in selectedLinks" :key="link.id ?? `${link.relation}-${link.toTitle}`">
              {{ link.toTitle }} · {{ link.relation }}
            </span>
          </div>
          <div v-else class="empty-block">暂无关联页面</div>
        </section>
      </section>

      <section v-else-if="selectedSourceDocument" class="detail-panel source-detail-panel">
        <div class="detail-toolbar">
          <div>
            <h2>{{ selectedSourceDocument.title }}</h2>
            <p>{{ selectedSourceDocument.source }} · {{ new Date(selectedSourceDocument.createdAt).toLocaleString() }}</p>
          </div>
          <div class="toolbar-actions">
            <button class="secondary-btn" type="button" @click="showDefaultWiki">
              返回 Wiki
            </button>
          </div>
        </div>
        <article class="source-content direct">
          <pre>{{ selectedSourceDocument.content }}</pre>
        </article>
      </section>

      <section v-else class="detail-panel empty-detail">
        <SvgIcon name="book" :size="32" />
        <h2>选择或生成一个 Wiki 页面</h2>
      </section>
    </main>
  </div>
</template>

<style scoped>
.wiki-view {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 18px;
  padding: 24px;
  color: var(--color-text-primary);
  overflow: hidden;
  box-sizing: border-box;
}

.wiki-sidebar,
.ingest-panel,
.editor-panel,
.detail-panel {
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
}

.wiki-sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.sidebar-header,
.detail-toolbar,
.ingest-panel {
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
  line-height: 1.2;
}

h2 {
  font-size: 18px;
  line-height: 1.35;
}

h3 {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.sidebar-header p,
.detail-toolbar p,
.ingest-copy p {
  margin-top: 5px;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px 36px;
  gap: 8px;
  margin-top: 16px;
}

.search-input,
.text-input,
.summary-textarea,
.content-textarea,
.source-textarea {
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.search-input,
.text-input {
  height: 36px;
  padding: 0 11px;
}

.summary-textarea,
.source-textarea {
  min-height: 90px;
  padding: 10px 11px;
  resize: vertical;
}

.content-textarea {
  min-height: 300px;
  padding: 10px 11px;
  resize: vertical;
  font-family: var(--font-mono);
}

.page-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  min-height: 0;
  overflow-y: auto;
}

.page-list-item {
  display: grid;
  gap: 4px;
  padding: 11px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  text-align: left;
  cursor: pointer;
}

.page-list-item.active {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.12);
}

.page-title {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.page-summary {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wiki-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: start;
  gap: 18px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.ingest-panel {
  padding: 16px;
}

.ingest-actions,
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.manual-ingest {
  grid-column: 1 / -1;
  width: 100%;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) auto;
  gap: 10px;
  margin-top: 12px;
}

.file-input {
  display: none;
}

.editor-panel,
.detail-panel {
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
}

.field-label {
  display: block;
  margin: 14px 0 6px;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.meta-row,
.wiki-tags,
.link-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.meta-row {
  margin-top: 14px;
}

.tag,
.alias,
.link-list span {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
}

.tag {
  color: var(--color-accent-light);
  background: rgba(99, 102, 241, 0.11);
  border: 1px solid rgba(99, 102, 241, 0.18);
}

.alias,
.link-list span {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-subtle);
}

.wiki-content {
  margin-top: 18px;
}

.wiki-content pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.75;
}

.evidence-section {
  margin-top: 22px;
}

.claim-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.source-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.claim-item,
.source-item,
.source-content,
.empty-block,
.empty-list {
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.16);
  padding: 10px 12px;
}

.source-item {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.source-item.active {
  border-color: rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.1);
}

.claim-item p {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.claim-source,
.source-meta,
.source-preview,
.empty-block,
.empty-list {
  color: var(--color-text-muted);
  font-size: 12px;
}

.claim-source {
  display: inline-block;
  margin-top: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-mono);
}

.claim-source:hover {
  color: var(--color-accent-light);
}

.source-title {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.source-preview {
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.source-content {
  margin-top: 10px;
}

.source-content header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.source-content pre {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.source-close {
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.source-close:hover {
  color: var(--color-text-primary);
}

.link-list {
  margin-top: 10px;
}

.empty-detail {
  min-height: 320px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--color-text-muted);
}

.icon-btn,
.primary-btn,
.secondary-btn,
.danger-btn {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  cursor: pointer;
  font-size: 13px;
}

.icon-btn {
  width: 36px;
  padding: 0;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
}

.icon-btn.muted {
  color: var(--color-text-muted);
}

.primary-btn {
  padding: 0 14px;
  color: #fff;
  background: var(--color-accent);
  border-color: transparent;
}

.secondary-btn {
  padding: 0 12px;
  color: var(--color-text-secondary);
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
  .wiki-view {
    height: auto;
    min-height: 100dvh;
    grid-template-columns: 1fr;
    padding: 16px;
    overflow: visible;
  }

  .wiki-sidebar {
    min-height: auto;
    overflow: visible;
  }

  .wiki-main,
  .editor-panel,
  .detail-panel {
    overflow: visible;
  }

  .manual-ingest {
    grid-template-columns: 1fr;
  }
}
</style>
