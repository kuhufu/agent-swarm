<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
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

interface ArtifactGroup {
  key: string;
  label: string;
  artifacts: WorkspaceArtifact[];
  totalSize: number;
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
const collapsedFolders = ref<Set<string>>(new Set());

const totalSize = computed(() => artifacts.value.reduce((sum, item) => sum + item.size, 0));
const selectedCount = computed(() => selectedPaths.value.size);
const finalArtifacts = computed(() => artifacts.value.filter((item) => item.final));
const selectedArtifacts = computed(() => artifacts.value.filter((item) => selectedPaths.value.has(item.path)));
const artifactGroups = computed<ArtifactGroup[]>(() => {
  const groups = new Map<string, WorkspaceArtifact[]>();
  for (const artifact of artifacts.value) {
    const dir = getArtifactDirectory(artifact.path);
    const items = groups.get(dir) ?? [];
    items.push(artifact);
    groups.set(dir, items);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: key || "根目录",
      artifacts: items,
      totalSize: items.reduce((sum, item) => sum + item.size, 0),
    }))
    .sort((a, b) => {
      if (a.key === "") return -1;
      if (b.key === "") return 1;
      return a.key.localeCompare(b.key);
    });
});
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
    collapsedFolders.value = new Set([...collapsedFolders.value].filter((folder) => artifacts.value.some((item) => getArtifactDirectory(item.path) === folder)));
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
  const directory = getArtifactDirectory(artifact.path);
  if (collapsedFolders.value.has(directory)) {
    const next = new Set(collapsedFolders.value);
    next.delete(directory);
    collapsedFolders.value = next;
  }
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

async function downloadArtifact(artifact?: WorkspaceArtifact) {
  const target = artifact ?? selectedArtifact.value;
  if (!target) return;
  try {
    const blob = await fetchArtifactBlob(target.path);
    await triggerDownload(blob, target.name);
    openMenuPath.value = null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
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
    await triggerDownload(blob, "workspace-artifacts.zip");
    batchMenuOpen.value = false;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
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
    await triggerDownload(blob, "workspace-all-artifacts.zip");
    batchMenuOpen.value = false;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    showError(error instanceof Error ? error.message : "下载工作区失败");
  }
}

async function importArtifact(artifact?: WorkspaceArtifact) {
  const target = artifact ?? selectedArtifact.value;
  if (!props.conversationId || !target) return;
  try {
    const response = await apiClient<{ data: { title: string } }>(
      `/conversations/${props.conversationId}/workspace/files/import-document`,
      {
        method: "POST",
        body: JSON.stringify({ path: target.path }),
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

async function deleteArtifact(artifact?: WorkspaceArtifact) {
  const target = artifact ?? selectedArtifact.value;
  if (!props.conversationId || !target) return;
  if (!window.confirm(`删除产物"${target.path}"？`)) return;
  try {
    await apiClient<{ data: { deleted: boolean } }>(
      `/conversations/${props.conversationId}/workspace/files?path=${encodeURIComponent(target.path)}`,
      { method: "DELETE" },
    );
    selectedPaths.value.delete(target.path);
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

async function triggerDownload(blob: Blob, filename: string) {
  if (filename.startsWith(".") && "showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
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

function toggleFolder(folder: string) {
  const next = new Set(collapsedFolders.value);
  if (next.has(folder)) {
    next.delete(folder);
  } else {
    next.add(folder);
  }
  collapsedFolders.value = next;
  openMenuPath.value = null;
  batchMenuOpen.value = false;
}

function handleClickOutside() {
  openMenuPath.value = null;
  batchMenuOpen.value = false;
}

onMounted(() => document.addEventListener("click", handleClickOutside));
onUnmounted(() => document.removeEventListener("click", handleClickOutside));

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

function getArtifactDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
  if (["js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "h", "hpp", "go", "rs", "swift", "kt", "rb", "php", "cs"].includes(ext)) return "fileCode";
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return "fileJson";
  if (["md", "txt", "rst", "log"].includes(ext)) return "file";
  return "file";
}

function getFileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "#a78bfa";
  if (["js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "h", "hpp", "go", "rs", "swift", "kt", "rb", "php", "cs"].includes(ext)) return "#60a5fa";
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return "#fbbf24";
  if (["md", "txt", "rst", "log"].includes(ext)) return "#94a3b8";
  return "#cbd5e1";
}
</script>

<template>
  <section class="workspace-artifacts">
    <header class="panel-header">
      <div class="header-info">
        <h3>产物</h3>
        <p>{{ artifacts.length }} 个文件 · {{ formatSize(totalSize) }}</p>
      </div>
      <button class="icon-btn" type="button" title="刷新" :disabled="loading" @click="loadArtifacts()">
        <SvgIcon name="refresh" :size="14" />
      </button>
    </header>

    <div v-if="conversationId && artifacts.length > 0" class="bulk-actions">
      <div class="bulk-summary">
        <button
          class="artifact-checkbox"
          :class="{ checked: selectedCount > 0 && selectedCount === artifacts.length, partial: selectedCount > 0 && selectedCount < artifacts.length }"
          type="button"
          :aria-label="selectedCount === artifacts.length ? '取消全选' : '全选'"
          @click="selectedCount === artifacts.length ? clearSelection() : selectAllArtifacts()"
        >
          <SvgIcon v-if="selectedCount > 0" name="check" :size="11" />
        </button>
        <span class="bulk-count">{{ selectedCount > 0 ? `${selectedCount} 已选` : `${artifacts.length} 个文件` }}</span>
      </div>
      <div v-if="selectedCount > 0" class="batch-menu-wrap">
        <button class="batch-trigger" type="button" title="批量操作" @click.stop="toggleBatchMenu">
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

    <div v-if="!conversationId" class="empty-state">
      <SvgIcon name="folder" :size="28" />
      <p>打开会话后查看产物</p>
    </div>
    <div v-else-if="!loading && artifacts.length === 0" class="empty-state">
      <SvgIcon name="folder" :size="28" />
      <p>暂无产物</p>
    </div>
    <div v-else class="artifact-layout">
      <section v-if="finalArtifacts.length > 0" class="final-section">
        <div class="section-title">
          <span class="section-label">
            <span class="final-dot" />
            最终结果
          </span>
          <span class="section-count">{{ finalArtifacts.length }}</span>
        </div>
        <div class="final-list">
          <article
            v-for="artifact in finalArtifacts"
            :key="`final-${artifact.path}`"
            class="artifact-card final-card"
            :class="{ active: selectedArtifact?.path === artifact.path }"
            @click="selectArtifact(artifact)"
            @dblclick="openPreview(artifact)"
          >
            <div class="file-icon" :style="{ color: getFileColor(artifact.name) }">
              <SvgIcon :name="getFileIcon(artifact.name)" :size="18" />
            </div>
            <div class="file-info">
              <div class="file-name-row">
                <span class="file-name">{{ artifact.name }}</span>
                <span class="file-size">{{ formatSize(artifact.size) }}</span>
              </div>
              <span class="file-path">{{ artifact.path }}</span>
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
        </div>
      </section>

      <div class="artifact-list">
        <section
          v-for="group in artifactGroups"
          :key="group.key || '__root__'"
          class="artifact-folder"
        >
          <button
            class="folder-header"
            type="button"
            :aria-expanded="!collapsedFolders.has(group.key)"
            @click="toggleFolder(group.key)"
          >
            <SvgIcon
              class="folder-chevron"
              :class="{ collapsed: collapsedFolders.has(group.key) }"
              name="chevronDown"
              :size="13"
            />
            <SvgIcon name="folder" :size="15" />
            <span class="folder-name">{{ group.label }}</span>
            <span class="folder-meta">{{ group.artifacts.length }} · {{ formatSize(group.totalSize) }}</span>
          </button>
          <div v-if="!collapsedFolders.has(group.key)" class="folder-files">
            <article
              v-for="artifact in group.artifacts"
              :key="artifact.path"
              class="artifact-card"
              :class="{ active: selectedArtifact?.path === artifact.path }"
              @click="selectArtifact(artifact)"
              @dblclick="openPreview(artifact)"
            >
              <button
                class="artifact-checkbox"
                :class="{ checked: selectedPaths.has(artifact.path) }"
                type="button"
                :aria-label="selectedPaths.has(artifact.path) ? '取消选择' : '选择文件'"
                :aria-pressed="selectedPaths.has(artifact.path)"
                @click.stop="toggleSelection(artifact.path)"
              >
                <SvgIcon v-if="selectedPaths.has(artifact.path)" name="check" :size="11" />
              </button>
              <div class="file-icon" :style="{ color: getFileColor(artifact.name) }">
                <SvgIcon :name="getFileIcon(artifact.name)" :size="18" />
              </div>
              <div class="file-info">
                <div class="file-name-row">
                  <span class="file-name">{{ artifact.name }}</span>
                  <span v-if="artifact.final" class="final-badge-inline">最终</span>
                  <span class="file-size">{{ formatSize(artifact.size) }}</span>
                </div>
                <span class="file-path">{{ artifact.path }}</span>
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
                  {{ artifact.final ? "取消最终" : "标记最终" }}
                </button>
                <button type="button" class="danger" @click="deleteArtifact(artifact)">
                  <SvgIcon name="trash" :size="13" />
                  删除
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div v-if="selectedArtifact" class="artifact-detail">
        <div class="detail-header">
          <div class="detail-icon" :style="{ color: getFileColor(selectedArtifact.name) }">
            <SvgIcon :name="getFileIcon(selectedArtifact.name)" :size="22" />
          </div>
          <div class="detail-info">
            <strong class="detail-name" :title="selectedArtifact.name">{{ selectedArtifact.name }}</strong>
            <div class="detail-meta">
              <span class="meta-kind">{{ selectedArtifact.kind }}</span>
              <span class="meta-right">
                <span>{{ formatSize(selectedArtifact.size) }}</span>
                <span v-if="selectedArtifact.updatedAt" class="meta-sep">·</span>
                <span v-if="selectedArtifact.updatedAt">{{ formatTime(selectedArtifact.updatedAt) }}</span>
              </span>
            </div>
          </div>
        </div>
        <div class="detail-actions">
          <button type="button" title="预览" :disabled="!selectedArtifact.previewable" @click="openPreview()">
            <SvgIcon name="search" :size="14" />
          </button>
          <button type="button" title="下载" @click="downloadArtifact()">
            <SvgIcon name="download" :size="14" />
          </button>
          <button type="button" title="加入文档" @click="importArtifact()">
            <SvgIcon name="book" :size="14" />
          </button>
          <button type="button" :title="selectedArtifact.final ? '取消最终' : '标记最终'" @click="toggleFinalArtifact(selectedArtifact)">
            <SvgIcon :name="selectedArtifact.final ? 'close' : 'check'" :size="14" />
          </button>
          <button type="button" title="删除" class="danger" @click="deleteArtifact()">
            <SvgIcon name="trash" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <teleport to="body">
      <div v-if="previewOpen && selectedArtifact" class="preview-modal" @click.self="closePreview">
        <section class="preview-dialog">
          <header class="preview-header">
            <div class="preview-title">
              <div class="preview-icon" :style="{ color: getFileColor(selectedArtifact.name) }">
                <SvgIcon :name="getFileIcon(selectedArtifact.name)" :size="18" />
              </div>
              <div>
                <strong>{{ selectedArtifact.name }}</strong>
                <span>{{ selectedArtifact.path }}</span>
              </div>
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
  gap: 10px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}

.header-info h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.header-info p {
  margin: 2px 0 0;
  color: var(--color-text-muted);
  font-size: 11px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.icon-btn:hover {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-text-primary);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.bulk-actions {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  flex-shrink: 0;
  height: 40px;
  box-sizing: border-box;
}

.bulk-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bulk-count {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.batch-menu-wrap {
  position: relative;
  flex: 0 0 auto;
}

.batch-trigger {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.batch-menu {
  top: 32px;
  right: 0;
}

.artifact-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.artifact-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}

.artifact-folder {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.folder-header {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.015);
  cursor: pointer;
  text-align: left;
}

.folder-header:hover {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.05);
}

.folder-chevron {
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}

.folder-chevron.collapsed {
  transform: rotate(-90deg);
}

.folder-name {
  min-width: 0;
  flex: 1;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-meta {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.folder-files {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.final-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.final-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.final-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

.section-count {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 7px;
  border-radius: 999px;
}

.artifact-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 36px 8px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.artifact-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.06);
}

.artifact-card.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.25);
}

.final-card {
  background: rgba(34, 197, 94, 0.06);
  border-color: rgba(34, 197, 94, 0.12);
}

.final-card:hover {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.22);
}

.final-card.active {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.35);
}

.file-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
}

.file-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.file-name {
  min-width: 0;
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
}

.file-path {
  color: var(--color-text-muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-badge-inline {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
  font-size: 9px;
  font-weight: 700;
}

.artifact-checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1.5px solid rgba(148, 163, 184, 0.22);
  border-radius: 4px;
  color: #fff;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
  overflow: hidden;
}

.artifact-checkbox:hover {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.08);
}

.artifact-checkbox.checked {
  border-color: #6366f1;
  background: #6366f1;
}

.artifact-checkbox.partial {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.25);
}

.menu-btn {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.artifact-card:hover .menu-btn {
  opacity: 1;
}

.menu-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

.artifact-menu {
  position: absolute;
  top: 30px;
  right: 4px;
  z-index: 12;
  min-width: 140px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.98);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}

.artifact-menu button {
  min-height: 28px;
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
  transition: all 0.1s ease;
}

.artifact-menu button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.artifact-menu button.danger {
  color: var(--color-danger);
}

.artifact-menu button.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.artifact-menu button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.artifact-detail {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.detail-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.detail-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-name {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--color-text-muted);
  font-size: 10px;
}

.meta-sep {
  opacity: 0.5;
}

.detail-actions {
  display: flex;
  gap: 5px;
}

.detail-actions button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.12s ease;
}

.detail-actions button:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.detail-actions button.danger {
  color: var(--color-danger);
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(239, 68, 68, 0.06);
}

.detail-actions button.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.25);
}

.detail-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.text-preview {
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
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
  background: rgba(2, 6, 23, 0.5);
}

.preview-dialog {
  width: min(1040px, calc(100vw - 80px));
  height: min(760px, calc(100vh - 80px));
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.96);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.preview-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.preview-header div:last-child:not(.preview-title) {
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
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 10px;
  color: var(--color-text-muted);
  text-align: center;
  font-size: 12px;
}

.empty-state :deep(svg) {
  opacity: 0.3;
}

.empty-state.compact {
  padding: 12px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.preview-note {
  margin: 8px 0 0;
  color: var(--color-text-muted);
  font-size: 11px;
  text-align: center;
}
</style>
