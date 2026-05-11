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
    <!-- Left Sidebar -->
    <aside class="wiki-sidebar">
      <div class="sidebar-header">
        <h2>LLM Wiki</h2>
        <p>管理和检索知识库页面</p>
      </div>

      <div class="search-box">
        <SvgIcon name="search" class="search-icon" :size="16" />
        <input
          v-model="searchQuery"
          class="input-field search-input"
          placeholder="搜索概念、标签或问题..."
          @keyup.enter="searchWiki"
        />
        <button v-if="searchResults.length" class="clear-btn" type="button" title="清除搜索" @click="clearSearch">
          <SvgIcon name="close" :size="12" />
        </button>
      </div>

      <nav class="wiki-nav">
        <div class="nav-divider">Wiki 页面</div>

        <button
          v-for="page in visiblePages"
          :key="page.id"
          class="nav-item page-nav-item"
          :class="{ active: selectedPage?.id === page.id }"
          type="button"
          @click="selectPage(page.id)"
        >
          <div class="page-nav-icon">
            <SvgIcon name="book" :size="16" />
          </div>
          <div>
            <span class="nav-label">{{ page.title }}</span>
            <span class="nav-desc">{{ page.summary || "暂无摘要" }}</span>
          </div>
        </button>

        <div v-if="!loading && visiblePages.length === 0" class="nav-empty">没有 Wiki 页面</div>
      </nav>

      <div class="sidebar-actions">
        <button class="upload-btn" type="button" @click="startCreate">
          <SvgIcon name="plus" :size="14" />
          新建页面
        </button>
      </div>
    </aside>

    <!-- Right Content -->
    <main class="wiki-main">

      <!-- Editor Panel -->
      <section v-if="editing" class="detail-panel editor-panel">
        <div class="detail-header">
          <div class="detail-title-row">
            <h3 class="detail-title">{{ selectedPage ? "编辑页面" : "新建页面" }}</h3>
          </div>
          <div class="detail-actions">
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

      <!-- Page Detail -->
      <section v-else-if="selectedPage" class="detail-panel">
        <div class="detail-header">
          <div class="detail-title-row">
            <div class="detail-icon">
              <SvgIcon name="book" :size="22" />
            </div>
            <div class="detail-title-info">
              <h3 class="detail-title">{{ selectedPage.title }}</h3>
              <div class="detail-meta">
                <span class="meta-text">{{ selectedPage.summary }}</span>
              </div>
            </div>
          </div>
          <div class="detail-actions">
            <button class="secondary-btn" type="button" @click="openDocumentsTab">
              <SvgIcon name="book" :size="14" />
              打开文档
            </button>
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
          <h4 class="section-title">
            <SvgIcon name="lightbulb" :size="14" style="margin-right: 6px;" />
            支撑要点
          </h4>
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
          <h4 class="section-title">
            <SvgIcon name="file" :size="14" style="margin-right: 6px;" />
            来源资料
          </h4>
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
          <h4 class="section-title">
            <SvgIcon name="link" :size="14" style="margin-right: 6px;" />
            关联页面
          </h4>
          <div v-if="selectedLinks.length" class="link-list">
            <span v-for="link in selectedLinks" :key="link.id ?? `${link.relation}-${link.toTitle}`">
              {{ link.toTitle }} · {{ link.relation }}
            </span>
          </div>
          <div v-else class="empty-block">暂无关联页面</div>
        </section>
      </section>

      <!-- Source Detail (direct) -->
      <section v-else-if="selectedSourceDocument" class="detail-panel">
        <div class="detail-header">
          <div class="detail-title-row">
            <div class="detail-icon">
              <SvgIcon name="file" :size="22" />
            </div>
            <div class="detail-title-info">
              <h3 class="detail-title">{{ selectedSourceDocument.title }}</h3>
              <div class="detail-meta">
                <span class="meta-text">{{ selectedSourceDocument.source }} · {{ new Date(selectedSourceDocument.createdAt).toLocaleString() }}</span>
              </div>
            </div>
          </div>
          <div class="detail-actions">
            <button class="secondary-btn" type="button" @click="showDefaultWiki">
              返回 Wiki
            </button>
          </div>
        </div>
        <article class="source-content direct">
          <pre>{{ selectedSourceDocument.content }}</pre>
        </article>
      </section>

      <!-- Empty State -->
      <section v-else class="empty-state">
        <div class="empty-icon">
          <SvgIcon name="book" :size="24" />
        </div>
        <p class="empty-title">选择或创建一个 Wiki 页面</p>
        <p class="empty-desc">从文档列表中选取来源文档，或点击新建按钮创建知识页面</p>
      </section>

    </main>
  </div>
</template>

<style scoped>
.wiki-view {
  height: 100%;
  overflow: hidden;
  display: flex;
}

/* Left Sidebar */
.wiki-sidebar {
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
.wiki-nav {
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
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.nav-item.active .nav-desc {
  color: var(--text-secondary);
}

.page-nav-icon {
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

.nav-item.active .page-nav-icon {
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

/* Right Content */
.wiki-main {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

/* Detail Panel */
.detail-panel {
  max-width: 720px;
}

.editor-panel {
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
  flex-wrap: wrap;
}

.primary-btn,
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

.primary-btn {
  color: var(--text-primary);
  background: var(--color-accent, #5f7038);
  border-color: transparent;
  color: #fff;
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

/* Editor fields */
.field-label {
  display: block;
  margin: 14px 0 6px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
}

.text-input,
.summary-textarea,
.content-textarea {
  width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: 9px;
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.text-input {
  height: 38px;
  padding: 0 12px;
}

.text-input:focus,
.summary-textarea:focus,
.content-textarea:focus {
  border-color: var(--border-default);
}

.summary-textarea {
  min-height: 80px;
  padding: 10px 12px;
  resize: vertical;
}

.content-textarea {
  min-height: 280px;
  padding: 10px 12px;
  resize: vertical;
  font-family: var(--font-mono);
}

/* Content sections */
.meta-row,
.link-list,
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}

.tag,
.alias,
.link-list span {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: var(--text-sm);
}

.tag {
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
}

.alias,
.link-list span {
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
}

.section-title {
  display: flex;
  align-items: center;
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
  margin: 24px 0 12px;
}

.wiki-content {
  margin-top: 20px;
}

.wiki-content pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-base);
  line-height: 1.75;
}

.evidence-section {
  margin-top: 28px;
}

.claim-list,
.source-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.claim-item,
.source-item,
.empty-block,
.source-content,
.chunk-card,
.chunk-item {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  padding: 12px 14px;
}

.source-item {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.source-item.active {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.claim-item p {
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: 1.55;
  margin: 0;
}

.claim-source {
  display: inline-block;
  margin-top: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-mono);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.claim-source:hover {
  color: var(--text-secondary);
}

.source-title {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 700;
}

.source-meta,
.source-preview,
.empty-block {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.source-preview {
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.source-content {
  margin-top: 12px;
}

.source-content header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: var(--text-base);
}

.source-content pre {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.source-close {
  padding: 0;
  border: 0;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-sm);
}

.source-close:hover {
  color: var(--text-primary);
}

.link-list {
  margin-top: 10px;
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
  .wiki-view {
    height: auto;
    min-height: 100dvh;
    flex-direction: column;
  }

  .wiki-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    padding: 16px;
    min-height: auto;
  }

  .wiki-main {
    padding: 16px;
    overflow: visible;
  }
}
</style>
