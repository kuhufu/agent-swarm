<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { apiClient } from "../../api/client.js";
import { showError, showSuccess } from "../../utils/ui-feedback.js";
import SvgIcon from "../common/SvgIcon.vue";

interface WorkspaceArtifact {
  path: string;
  name: string;
  size: number;
  kind: string;
  language?: string;
  mimeType: string;
  previewable: boolean;
  createdAt?: number;
  updatedAt?: number;
  downloadUrl: string;
  final: boolean;
}

interface ArtifactContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  kind: string;
  language?: string;
  mimeType: string;
  previewable: boolean;
}

const props = defineProps<{
  conversationId: string | null;
  selectedPath?: string | null;
  refreshKey?: string | number;
}>();

const artifacts = ref<WorkspaceArtifact[]>([]);
const selectedArtifact = ref<WorkspaceArtifact | null>(null);
const preview = ref<ArtifactContent | null>(null);
const imageUrl = ref<string | null>(null);
const loading = ref(false);
const previewLoading = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const previewOpen = ref(false);
const openMenuPath = ref<string | null>(null);
const batchMenuOpen = ref(false);

const totalSize = computed(() => artifacts.value.reduce((sum, item) => sum + item.size, 0));
const selectedCount = computed(() => selectedPaths.value.size);
const finalArtifacts = computed(() => artifacts.value.filter((item) => item.final));
const selectedArtifacts = computed(() => artifacts.value.filter((item) => selectedPaths.value.has(item.path)));
const highlightedPreview = computed(() => {
  if (!preview.value || preview.value.kind !== "code") return "";
  const language = preview.value.language ?? "";
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(preview.value.content, { language, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(preview.value.content).value;
});

watch(
  () => props.conversationId,
  () => {
    void loadArtifacts();
  },
  { immediate: true },
);

watch(
  () => props.selectedPath,
  (path) => {
    if (!path) return;
    const match = artifacts.value.find((item) => item.path === path);
    if (match) {
      void selectArtifact(match);
      return;
    }
    void loadArtifacts(path);
  },
);

watch(
  () => props.refreshKey,
  () => {
    if (props.conversationId) {
      void loadArtifacts();
    }
  },
);

onBeforeUnmount(() => {
  revokeImageUrl();
});

async function loadArtifacts(nextSelectedPath?: string) {
  if (!props.conversationId) {
    artifacts.value = [];
    selectedArtifact.value = null;
    preview.value = null;
    revokeImageUrl();
    return;
  }
  loading.value = true;
  try {
    const response = await apiClient<{ data: WorkspaceArtifact[] }>(
      `/conversations/${props.conversationId}/workspace/files`,
    );
    artifacts.value = response.data ?? [];
    selectedPaths.value = new Set([...selectedPaths.value].filter((path) => artifacts.value.some((item) => item.path === path)));
    const targetPath = nextSelectedPath ?? props.selectedPath ?? selectedArtifact.value?.path;
    const target = targetPath
      ? artifacts.value.find((item) => item.path === targetPath)
      : (finalArtifacts.value[0] ?? artifacts.value[0]);
    if (target) {
      await selectArtifact(target);
    } else {
      selectedArtifact.value = null;
      preview.value = null;
      revokeImageUrl();
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载产物失败");
  } finally {
    loading.value = false;
  }
}

async function selectArtifact(artifact: WorkspaceArtifact) {
  selectedArtifact.value = artifact;
  openMenuPath.value = null;
  batchMenuOpen.value = false;
}

async function openPreview(artifact = selectedArtifact.value) {
  if (!artifact) return;
  selectedArtifact.value = artifact;
  openMenuPath.value = null;
  previewOpen.value = true;
  preview.value = null;
  revokeImageUrl();
  if (!props.conversationId || !artifact.previewable) return;
  if (artifact.kind === "image") {
    await loadImagePreview(artifact);
    return;
  }
  previewLoading.value = true;
  try {
    const response = await apiClient<{ data: ArtifactContent }>(
      `/conversations/${props.conversationId}/workspace/files/content?path=${encodeURIComponent(artifact.path)}`,
    );
    preview.value = response.data;
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载预览失败");
  } finally {
    previewLoading.value = false;
  }
}

function closePreview() {
  previewOpen.value = false;
}

async function loadImagePreview(artifact: WorkspaceArtifact) {
  previewLoading.value = true;
  try {
    const blob = await fetchArtifactBlob(artifact.path);
    imageUrl.value = URL.createObjectURL(blob);
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载图片失败");
  } finally {
    previewLoading.value = false;
  }
}

async function downloadArtifact(artifact: WorkspaceArtifact) {
  try {
    const blob = await fetchArtifactBlob(artifact.path);
    triggerDownload(blob, artifact.name);
    openMenuPath.value = null;
  } catch (error) {
    showError(error instanceof Error ? error.message : "下载产物失败");
  }
}

async function downloadSelectedArtifacts() {
  if (!props.conversationId || selectedPaths.value.size === 0) return;
  try {
    const blob = await postArtifactBlob(
      `/api/conversations/${props.conversationId}/workspace/files/download-zip`,
      { paths: [...selectedPaths.value] },
    );
    triggerDownload(blob, "workspace-artifacts.zip");
    batchMenuOpen.value = false;
  } catch (error) {
    showError(error instanceof Error ? error.message : "下载产物失败");
  }
}

async function downloadAllArtifacts() {
  if (!props.conversationId || artifacts.value.length === 0) return;
  try {
    const blob = await postArtifactBlob(
      `/api/conversations/${props.conversationId}/workspace/files/download-zip`,
      { paths: artifacts.value.map((item) => item.path) },
    );
    triggerDownload(blob, "workspace-all-artifacts.zip");
    batchMenuOpen.value = false;
  } catch (error) {
    showError(error instanceof Error ? error.message : "下载工作区失败");
  }
}

async function importArtifact(artifact = selectedArtifact.value) {
  if (!props.conversationId || !artifact) return;
  try {
    const response = await apiClient<{ data: { title: string } }>(
      `/conversations/${props.conversationId}/workspace/files/import-document`,
      {
        method: "POST",
        body: JSON.stringify({ path: artifact.path }),
      },
    );
    openMenuPath.value = null;
    showSuccess(`已加入文档：${response.data.title}`);
  } catch (error) {
    showError(error instanceof Error ? error.message : "加入文档失败");
  }
}

async function importSelectedArtifacts() {
  if (!props.conversationId || selectedArtifacts.value.length === 0) return;
  let successCount = 0;
  for (const artifact of selectedArtifacts.value) {
    try {
      await apiClient<{ data: { title: string } }>(
        `/conversations/${props.conversationId}/workspace/files/import-document`,
        {
          method: "POST",
          body: JSON.stringify({ path: artifact.path }),
        },
      );
      successCount += 1;
    } catch (error) {
      showError(error instanceof Error ? error.message : `加入文档失败：${artifact.path}`);
      return;
    }
  }
  batchMenuOpen.value = false;
  showSuccess(`已加入文档：${successCount} 个文件`);
}

async function toggleFinalArtifact(artifact: WorkspaceArtifact) {
  if (!props.conversationId) return;
  try {
    const nextFinal = !artifact.final;
    await apiClient<{ data: { path: string; final: boolean } }>(
      `/conversations/${props.conversationId}/workspace/files/final`,
      {
        method: "PATCH",
        body: JSON.stringify({ path: artifact.path, final: nextFinal }),
      },
    );
    artifact.final = nextFinal;
    selectedArtifact.value = { ...artifact };
    artifacts.value = artifacts.value.map((item) => item.path === artifact.path ? { ...item, final: nextFinal } : item);
    openMenuPath.value = null;
    showSuccess(nextFinal ? "已标记为最终结果" : "已取消最终结果");
  } catch (error) {
    showError(error instanceof Error ? error.message : "更新标记失败");
  }
}

async function setSelectedFinalArtifacts(final: boolean) {
  if (!props.conversationId || selectedArtifacts.value.length === 0) return;
  const targets = selectedArtifacts.value.filter((item) => item.final !== final);
  if (targets.length === 0) {
    batchMenuOpen.value = false;
    showSuccess(final ? "所选文件已是最终结果" : "所选文件已取消最终结果");
    return;
  }
  for (const artifact of targets) {
    try {
      await apiClient<{ data: { path: string; final: boolean } }>(
        `/conversations/${props.conversationId}/workspace/files/final`,
        {
          method: "PATCH",
          body: JSON.stringify({ path: artifact.path, final }),
        },
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : `更新标记失败：${artifact.path}`);
      return;
    }
  }
  artifacts.value = artifacts.value.map((item) => selectedPaths.value.has(item.path) ? { ...item, final } : item);
  if (selectedArtifact.value && selectedPaths.value.has(selectedArtifact.value.path)) {
    selectedArtifact.value = { ...selectedArtifact.value, final };
  }
  batchMenuOpen.value = false;
  showSuccess(final ? `已标记最终结果：${targets.length} 个文件` : `已取消最终结果：${targets.length} 个文件`);
}

async function deleteArtifact(artifact = selectedArtifact.value) {
  if (!props.conversationId || !artifact) return;
  if (!window.confirm(`删除产物“${artifact.path}”？`)) return;
  try {
    await apiClient<{ data: { deleted: boolean } }>(
      `/conversations/${props.conversationId}/workspace/files?path=${encodeURIComponent(artifact.path)}`,
      { method: "DELETE" },
    );
    selectedPaths.value.delete(artifact.path);
    selectedPaths.value = new Set(selectedPaths.value);
    openMenuPath.value = null;
    showSuccess("产物已删除");
    await loadArtifacts();
  } catch (error) {
    showError(error instanceof Error ? error.message : "删除产物失败");
  }
}

async function deleteSelectedArtifacts() {
  if (!props.conversationId || selectedArtifacts.value.length === 0) return;
  if (!window.confirm(`删除选中的 ${selectedArtifacts.value.length} 个产物？`)) return;
  const targets = [...selectedArtifacts.value];
  for (const artifact of targets) {
    try {
      await apiClient<{ data: { deleted: boolean } }>(
        `/conversations/${props.conversationId}/workspace/files?path=${encodeURIComponent(artifact.path)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : `删除产物失败：${artifact.path}`);
      return;
    }
  }
  selectedPaths.value = new Set();
  openMenuPath.value = null;
  batchMenuOpen.value = false;
  showSuccess(`已删除 ${targets.length} 个产物`);
  await loadArtifacts();
}

async function fetchArtifactBlob(path: string): Promise<Blob> {
  if (!props.conversationId) throw new Error("没有打开的会话");
  const token = localStorage.getItem("token");
  const response = await fetch(
    `/api/conversations/${props.conversationId}/workspace/files/download?path=${encodeURIComponent(path)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.blob();
}

async function postArtifactBlob(url: string, body: unknown): Promise<Blob> {
  const token = localStorage.getItem("token");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return response.blob();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toggleSelection(path: string) {
  const next = new Set(selectedPaths.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  selectedPaths.value = next;
}

function selectAllArtifacts() {
  selectedPaths.value = new Set(artifacts.value.map((item) => item.path));
}

function clearSelection() {
  selectedPaths.value = new Set();
  batchMenuOpen.value = false;
}

function toggleArtifactMenu(path: string) {
  batchMenuOpen.value = false;
  openMenuPath.value = openMenuPath.value === path ? null : path;
}

function toggleBatchMenu() {
  openMenuPath.value = null;
  batchMenuOpen.value = !batchMenuOpen.value;
}

function revokeImageUrl() {
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatTime(value?: number): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}
</script>

<template>
  <section class="workspace-artifacts">
    <header class="panel-header">
      <div>
        <h3>产物</h3>
        <p>{{ artifacts.length }} 个文件 · {{ formatSize(totalSize) }}</p>
      </div>
      <button class="icon-btn" type="button" title="刷新" :disabled="loading" @click="loadArtifacts()">
        <SvgIcon name="refresh" :size="14" />
      </button>
    </header>
    <div v-if="conversationId && artifacts.length > 0" class="bulk-actions">
      <div class="bulk-summary">
        <span>{{ selectedCount }} 已选</span>
        <button v-if="selectedCount < artifacts.length" type="button" @click="selectAllArtifacts">全选</button>
        <button v-else type="button" @click="clearSelection">清空</button>
      </div>
      <div v-if="selectedCount > 0" class="batch-menu-wrap">
        <button class="batch-trigger" type="button" title="批量操作" @click="toggleBatchMenu">
          <SvgIcon name="moreHorizontal" :size="14" />
        </button>
        <div v-if="batchMenuOpen" class="artifact-menu batch-menu" @click.stop>
          <button type="button" @click="downloadSelectedArtifacts">
            <SvgIcon name="download" :size="13" />
            下载已选
          </button>
          <button type="button" @click="downloadAllArtifacts">
            <SvgIcon name="download" :size="13" />
            下载全部
          </button>
          <button type="button" @click="importSelectedArtifacts">
            <SvgIcon name="book" :size="13" />
            加入文档
          </button>
          <button type="button" @click="setSelectedFinalArtifacts(true)">
            <SvgIcon name="check" :size="13" />
            标记最终
          </button>
          <button type="button" @click="setSelectedFinalArtifacts(false)">
            <SvgIcon name="close" :size="13" />
            取消最终
          </button>
          <button class="danger" type="button" @click="deleteSelectedArtifacts">
            <SvgIcon name="trash" :size="13" />
            删除已选
          </button>
        </div>
      </div>
    </div>

    <div v-if="!conversationId" class="empty-state">打开会话后查看产物</div>
    <div v-else-if="!loading && artifacts.length === 0" class="empty-state">暂无产物</div>
    <div v-else class="artifact-layout">
      <section v-if="finalArtifacts.length > 0" class="final-section">
        <div class="section-title">
          <strong>最终结果</strong>
          <span>{{ finalArtifacts.length }}</span>
        </div>
        <article
          v-for="artifact in finalArtifacts"
          :key="`final-${artifact.path}`"
          class="final-item"
          :class="{ active: selectedArtifact?.path === artifact.path }"
          @click="selectArtifact(artifact)"
          @dblclick="openPreview(artifact)"
        >
          <div>
            <span>{{ artifact.name }}</span>
            <small>{{ artifact.path }}</small>
          </div>
          <button class="menu-btn" type="button" title="文件操作" @click.stop="toggleArtifactMenu(artifact.path)">
            <SvgIcon name="moreHorizontal" :size="14" />
          </button>
          <div v-if="openMenuPath === artifact.path" class="artifact-menu" @click.stop>
            <button type="button" :disabled="!artifact.previewable" @click="openPreview(artifact)">
              <SvgIcon name="search" :size="13" />
              预览
            </button>
            <button type="button" @click="downloadArtifact(artifact)">
              <SvgIcon name="download" :size="13" />
              下载
            </button>
            <button type="button" @click="importArtifact(artifact)">
              <SvgIcon name="book" :size="13" />
              加入文档
            </button>
            <button type="button" @click="toggleFinalArtifact(artifact)">
              <SvgIcon name="check" :size="13" />
              取消最终
            </button>
            <button type="button" class="danger" @click="deleteArtifact(artifact)">
              <SvgIcon name="trash" :size="13" />
              删除
            </button>
          </div>
        </article>
      </section>

      <div class="artifact-list">
        <article
          v-for="artifact in artifacts"
          :key="artifact.path"
          class="artifact-item"
          :class="{ active: selectedArtifact?.path === artifact.path }"
          @click="selectArtifact(artifact)"
          @dblclick="openPreview(artifact)"
        >
          <span class="artifact-row">
            <button
              class="artifact-checkbox"
              :class="{ checked: selectedPaths.has(artifact.path) }"
              type="button"
              :aria-label="selectedPaths.has(artifact.path) ? '取消选择' : '选择文件'"
              :aria-pressed="selectedPaths.has(artifact.path)"
              @click.stop="toggleSelection(artifact.path)"
            >
              <SvgIcon v-if="selectedPaths.has(artifact.path)" name="check" :size="12" />
            </button>
            <span class="artifact-name">{{ artifact.name }}</span>
            <span v-if="artifact.final" class="final-badge">最终</span>
          </span>
          <span class="artifact-path">{{ artifact.path }}</span>
          <span class="artifact-meta">{{ artifact.kind }} · {{ formatSize(artifact.size) }}</span>
          <button class="menu-btn" type="button" title="文件操作" @click.stop="toggleArtifactMenu(artifact.path)">
            <SvgIcon name="moreHorizontal" :size="14" />
          </button>
          <div v-if="openMenuPath === artifact.path" class="artifact-menu" @click.stop>
            <button type="button" :disabled="!artifact.previewable" @click="openPreview(artifact)">
              <SvgIcon name="search" :size="13" />
              预览
            </button>
            <button type="button" @click="downloadArtifact(artifact)">
              <SvgIcon name="download" :size="13" />
              下载
            </button>
            <button type="button" @click="importArtifact(artifact)">
              <SvgIcon name="book" :size="13" />
              加入文档
            </button>
            <button type="button" @click="toggleFinalArtifact(artifact)">
              <SvgIcon name="check" :size="13" />
              {{ artifact.final ? "取消最终" : "标记最终" }}
            </button>
            <button type="button" class="danger" @click="deleteArtifact(artifact)">
              <SvgIcon name="trash" :size="13" />
              删除
            </button>
          </div>
        </article>
      </div>

      <div v-if="selectedArtifact" class="artifact-detail">
        <div class="detail-title">
          <div>
            <strong>{{ selectedArtifact.name }}</strong>
            <span>{{ formatTime(selectedArtifact.updatedAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <teleport to="body">
      <div v-if="previewOpen && selectedArtifact" class="preview-modal" @click.self="closePreview">
        <section class="preview-dialog">
          <header class="preview-header">
            <div>
              <strong>{{ selectedArtifact.name }}</strong>
              <span>{{ selectedArtifact.path }}</span>
            </div>
            <button class="icon-btn" type="button" title="关闭" @click="closePreview">
              <SvgIcon name="close" :size="15" />
            </button>
          </header>
          <div class="preview-body">
            <div v-if="previewLoading" class="empty-state compact">加载中...</div>
            <img v-else-if="imageUrl" class="image-preview" :src="imageUrl" :alt="selectedArtifact.name">
            <pre v-else-if="preview?.kind === 'code'" class="text-preview code-preview"><code class="hljs" v-html="highlightedPreview" /></pre>
            <pre v-else-if="preview" class="text-preview">{{ preview.content }}</pre>
            <div v-else class="empty-state compact">该文件暂不支持预览</div>
            <p v-if="preview?.truncated" class="preview-note">内容过长，已截断显示</p>
          </div>
        </section>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.workspace-artifacts {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.panel-header,
.detail-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.panel-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.panel-header p,
.detail-title span,
.artifact-path,
.artifact-meta,
.preview-note {
  color: var(--color-text-muted);
  font-size: 11px;
}

.bulk-actions {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.bulk-summary {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bulk-summary span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.bulk-actions button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  font-size: 12px;
}

.bulk-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.batch-menu-wrap {
  position: relative;
  flex: 0 0 auto;
}

.batch-trigger {
  width: 30px;
  padding: 0;
  justify-content: center;
}

.batch-menu {
  top: 34px;
  right: 0;
}

.icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.icon-btn.danger {
  color: var(--color-danger);
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.08);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.artifact-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.artifact-list {
  flex: 1;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
}

.final-section {
  display: grid;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-muted);
  font-size: 11px;
}

.section-title strong {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.final-item {
  position: relative;
  display: grid;
  gap: 3px;
  padding: 9px 44px 9px 10px;
  border: 1px solid rgba(34, 197, 94, 0.22);
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: rgba(34, 197, 94, 0.08);
  text-align: left;
  cursor: pointer;
}

.final-item.active {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(34, 197, 94, 0.14);
}

.final-item span {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-item small {
  color: var(--color-text-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.artifact-item {
  position: relative;
  display: grid;
  gap: 3px;
  padding: 9px 44px 9px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  text-align: left;
  cursor: pointer;
}

.artifact-item.active {
  border-color: rgba(99, 102, 241, 0.42);
  background: rgba(99, 102, 241, 0.12);
}

.artifact-name {
  min-width: 0;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}

.final-badge {
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--color-success);
  background: rgba(34, 197, 94, 0.12);
  font-size: 10px;
  font-weight: 700;
  flex: 0 0 auto;
}

.artifact-checkbox {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 5px;
  color: #fff;
  background: rgba(255, 255, 255, 0.035);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.artifact-checkbox:hover {
  border-color: rgba(99, 102, 241, 0.55);
  background: rgba(99, 102, 241, 0.1);
}

.artifact-checkbox.checked {
  border-color: rgba(99, 102, 241, 0.85);
  background: #6366f1;
}

.artifact-path {
  overflow-wrap: anywhere;
}

.menu-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.menu-btn:hover {
  color: var(--color-text-primary);
  border-color: rgba(99, 102, 241, 0.32);
  background: rgba(99, 102, 241, 0.1);
}

.artifact-menu {
  position: absolute;
  top: 38px;
  right: 8px;
  z-index: 12;
  min-width: 132px;
  display: grid;
  gap: 3px;
  padding: 6px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.98);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.34);
}

.artifact-menu button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: var(--color-text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.artifact-menu button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.artifact-menu button.danger {
  color: var(--color-danger);
}

.artifact-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.artifact-detail {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.detail-title strong {
  display: block;
  color: var(--color-text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.text-preview {
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-preview {
  white-space: pre;
}

.code-preview code {
  display: block;
  padding: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
}

.image-preview {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.preview-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(10px);
}

.preview-dialog {
  width: min(1040px, calc(100vw - 80px));
  height: min(760px, calc(100vh - 80px));
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.preview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.preview-header div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.preview-header strong {
  color: var(--color-text-primary);
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-header span {
  color: var(--color-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.preview-body {
  flex: 1;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.empty-state {
  padding: 16px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.025);
  text-align: center;
  font-size: 12px;
}

.empty-state.compact {
  padding: 12px 10px;
}
</style>
