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

const route = useRoute();
const router = useRouter();

const pages = ref<WikiPage[]>([]);
const selectedPage = ref<WikiPage | null>(null);
const searchQuery = ref("");
const searchResults = ref<WikiSearchResult[]>([]);
const loading = ref(false);
const saving = ref(false);
const ingesting = ref(false);
const editing = ref(false);
const draft = ref({
  title: "",
  summary: "",
  content: "",
  aliases: "",
  tags: "",
});
const manualSource = ref({
  filename: "",
  content: "",
});
const fileInput = ref<HTMLInputElement | null>(null);

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

onMounted(async () => {
  await loadPages();
  await openRouteWikiPage();
});

watch(() => route.query.wiki, () => {
  void openRouteWikiPage();
});

async function loadPages() {
  loading.value = true;
  try {
    const response = await apiClient<{ data: WikiPage[] }>("/wiki/pages");
    pages.value = response.data ?? [];
    if (!selectedPage.value && pages.value[0]) {
      await selectPage(pages.value[0].id);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载 Wiki 失败");
  } finally {
    loading.value = false;
  }
}

async function openRouteWikiPage() {
  const id = typeof route.query.wiki === "string" ? route.query.wiki : "";
  if (!id) return;
  await selectPage(id, false);
}

async function selectPage(id: string, syncRoute = true) {
  try {
    const response = await apiClient<{ data: WikiPage }>(`/wiki/pages/${id}`);
    selectedPage.value = response.data;
    editing.value = false;
    fillDraft(response.data);
    if (syncRoute) {
      void router.replace({ name: "documents", query: { ...route.query, wiki: id } });
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "打开 Wiki 页面失败");
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
  editing.value = true;
  draft.value = { title: "", summary: "", content: "", aliases: "", tags: "" };
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

async function ingestManualSource() {
  if (!manualSource.value.filename.trim() || !manualSource.value.content.trim()) {
    showError("资料标题和内容不能为空");
    return;
  }
  ingesting.value = true;
  try {
    const response = await apiClient<{ data: { pages: WikiPage[]; generatedBy: string } }>("/wiki/ingest-document", {
      method: "POST",
      body: JSON.stringify({
        filename: manualSource.value.filename,
        content: manualSource.value.content,
      }),
    });
    manualSource.value = { filename: "", content: "" };
    await loadPages();
    const firstPage = response.data.pages[0];
    if (firstPage) await selectPage(firstPage.id);
    showSuccess(response.data.generatedBy === "llm" ? "已生成 Wiki 页面" : "已使用基础模式生成 Wiki 页面");
  } catch (error) {
    showError(error instanceof Error ? error.message : "生成 Wiki 失败");
  } finally {
    ingesting.value = false;
  }
}

async function ingestFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  ingesting.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await apiClient<{ data: { pages: WikiPage[]; generatedBy: string } }>("/wiki/ingest-document", {
      method: "POST",
      body: form,
    });
    await loadPages();
    const firstPage = response.data.pages[0];
    if (firstPage) await selectPage(firstPage.id);
    showSuccess(response.data.generatedBy === "llm" ? "文件已生成 Wiki 页面" : "文件已使用基础模式生成 Wiki 页面");
  } catch (error) {
    showError(error instanceof Error ? error.message : "导入文件失败");
  } finally {
    ingesting.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

function splitCsv(value: string): string[] {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
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
          <h2>导入资料生成 Wiki</h2>
          <p>上传文件或粘贴资料，系统会生成可编辑的知识页面、要点和来源引用。</p>
        </div>
        <div class="ingest-actions">
          <input ref="fileInput" class="file-input" type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.pdf,.docx" @change="ingestFile">
          <button class="secondary-btn" type="button" :disabled="ingesting" @click="fileInput?.click()">
            <SvgIcon name="upload" :size="15" />
            导入文件
          </button>
        </div>
        <div class="manual-ingest">
          <input v-model="manualSource.filename" class="text-input" type="text" placeholder="资料标题">
          <textarea v-model="manualSource.content" class="source-textarea" placeholder="粘贴资料内容" />
          <button class="primary-btn" type="button" :disabled="ingesting" @click="ingestManualSource">
            {{ ingesting ? "生成中..." : "生成 Wiki" }}
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
              <span v-if="claim.sourceDocumentId">来源 {{ claim.sourceDocumentId.slice(0, 8) }}</span>
            </div>
          </div>
          <div v-else class="empty-block">暂无支撑要点</div>
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

      <section v-else class="detail-panel empty-detail">
        <SvgIcon name="book" :size="32" />
        <h2>选择或生成一个 Wiki 页面</h2>
      </section>
    </main>
  </div>
</template>

<style scoped>
.wiki-view {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 18px;
  padding: 24px;
  color: var(--color-text-primary);
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
  min-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  padding: 16px;
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
  align-content: start;
  gap: 18px;
  min-width: 0;
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
  padding: 18px;
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

.claim-item,
.empty-block,
.empty-list {
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.16);
  padding: 10px 12px;
}

.claim-item p {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.claim-item span,
.empty-block,
.empty-list {
  color: var(--color-text-muted);
  font-size: 12px;
}

.claim-item span {
  display: inline-block;
  margin-top: 5px;
  font-family: var(--font-mono);
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
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .wiki-sidebar {
    min-height: auto;
  }

  .manual-ingest {
    grid-template-columns: 1fr;
  }
}
</style>
