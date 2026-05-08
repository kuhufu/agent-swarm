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

const totalSize = computed(() => artifacts.value.reduce((sum, item) => sum + item.size, 0));
const selectedCount = computed(() => selectedPaths.value.size);
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
    const target = targetPath ? artifacts.value.find((item) => item.path === targetPath) : artifacts.value[0];
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
  } catch (error) {
    showError(error instanceof Error ? error.message : "下载产物失败");
  }
}

async function importSelectedArtifact() {
  if (!props.conversationId || !selectedArtifact.value) return;
  try {
    const response = await apiClient<{ data: { title: string } }>(
      `/conversations/${props.conversationId}/workspace/files/import-document`,
      {
        method: "POST",
        body: JSON.stringify({ path: selectedArtifact.value.path }),
      },
    );
    showSuccess(`已加入文档：${response.data.title}`);
  } catch (error) {
    showError(error instanceof Error ? error.message : "加入文档失败");
  }
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
    showSuccess(nextFinal ? "已标记为最终结果" : "已取消最终结果");
  } catch (error) {
    showError(error instanceof Error ? error.message : "更新标记失败");
  }
}

async function deleteSelectedArtifact() {
  if (!props.conversationId || !selectedArtifact.value) return;
  if (!window.confirm(`删除产物“${selectedArtifact.value.path}”？`)) return;
  try {
    await apiClient<{ data: { deleted: boolean } }>(
      `/conversations/${props.conversationId}/workspace/files?path=${encodeURIComponent(selectedArtifact.value.path)}`,
      { method: "DELETE" },
    );
    selectedPaths.value.delete(selectedArtifact.value.path);
    selectedPaths.value = new Set(selectedPaths.value);
    showSuccess("产物已删除");
    await loadArtifacts();
  } catch (error) {
    showError(error instanceof Error ? error.message : "删除产物失败");
  }
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
      <span>{{ selectedCount }} 已选</span>
      <button type="button" :disabled="selectedCount === 0" @click="downloadSelectedArtifacts">
        <SvgIcon name="download" :size="13" />
        打包
      </button>
    </div>

    <div v-if="!conversationId" class="empty-state">打开会话后查看产物</div>
    <div v-else-if="!loading && artifacts.length === 0" class="empty-state">暂无产物</div>
    <div v-else class="artifact-layout">
      <div class="artifact-list">
        <button
          v-for="artifact in artifacts"
          :key="artifact.path"
          class="artifact-item"
          :class="{ active: selectedArtifact?.path === artifact.path }"
          type="button"
          @click="selectArtifact(artifact)"
        >
          <span class="artifact-row">
            <input
              type="checkbox"
              :checked="selectedPaths.has(artifact.path)"
              @click.stop
              @change.stop="toggleSelection(artifact.path)"
            >
            <span class="artifact-name">{{ artifact.name }}</span>
            <span v-if="artifact.final" class="final-badge">最终</span>
          </span>
          <span class="artifact-path">{{ artifact.path }}</span>
          <span class="artifact-meta">{{ artifact.kind }} · {{ formatSize(artifact.size) }}</span>
        </button>
      </div>

      <div v-if="selectedArtifact" class="artifact-detail">
        <div class="detail-title">
          <div>
            <strong>{{ selectedArtifact.name }}</strong>
            <span>{{ formatTime(selectedArtifact.updatedAt) }}</span>
          </div>
          <div class="detail-actions">
            <button class="icon-btn" type="button" title="加入文档" @click="importSelectedArtifact">
              <SvgIcon name="book" :size="14" />
            </button>
            <button class="icon-btn" type="button" :title="selectedArtifact.final ? '取消最终结果' : '标记最终结果'" @click="toggleFinalArtifact(selectedArtifact)">
              <SvgIcon name="check" :size="14" />
            </button>
            <button class="icon-btn" type="button" title="下载" @click="downloadArtifact(selectedArtifact)">
              <SvgIcon name="download" :size="14" />
            </button>
            <button class="icon-btn danger" type="button" title="删除" @click="deleteSelectedArtifact">
              <SvgIcon name="trash" :size="14" />
            </button>
          </div>
        </div>

        <div v-if="previewLoading" class="empty-state compact">加载中...</div>
        <img v-else-if="imageUrl" class="image-preview" :src="imageUrl" :alt="selectedArtifact.name">
        <pre v-else-if="preview?.kind === 'code'" class="text-preview code-preview"><code class="hljs" v-html="highlightedPreview" /></pre>
        <pre v-else-if="preview" class="text-preview">{{ preview.content }}</pre>
        <div v-else class="empty-state compact">该文件暂不支持预览</div>
        <p v-if="preview?.truncated" class="preview-note">内容过长，已截断显示</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace-artifacts {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.bulk-actions span {
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

.artifact-layout {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.artifact-list {
  max-height: 210px;
  display: grid;
  gap: 8px;
  overflow-y: auto;
}

.artifact-item {
  display: grid;
  gap: 3px;
  padding: 9px 10px;
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

.artifact-row input {
  width: 14px;
  height: 14px;
  accent-color: var(--color-accent);
  flex: 0 0 auto;
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

.artifact-path {
  overflow-wrap: anywhere;
}

.artifact-detail {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-title strong {
  display: block;
  color: var(--color-text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.detail-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.text-preview {
  max-height: 340px;
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
  max-height: 340px;
  object-fit: contain;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
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
