<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { diffLines, type Change } from "diff";
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
  versionCount: number;
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
  versionId?: string;
}

interface WorkspaceFileVersion {
  id: string;
  path: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

interface ArtifactGroup {
  key: string;
  label: string;
  artifacts: WorkspaceArtifact[];
  totalSize: number;
}

const props = defineProps<{
  workspaceId: string | null;
  selectedPath?: string | null;
  refreshKey?: string | number;
}>();

const artifacts = ref<WorkspaceArtifact[]>([]);
const selectedArtifact = ref<WorkspaceArtifact | null>(null);
const preview = ref<ArtifactContent | null>(null);
const imageUrl = ref<string | null>(null);
const loading = ref(false);
const previewLoading = ref(false);
const versionsLoading = ref(false);
const selectedPaths = ref<Set<string>>(new Set());
const previewOpen = ref(false);
const openMenuPath = ref<string | null>(null);
const batchMenuOpen = ref(false);
const collapsedFolders = ref<Set<string>>(new Set());
const searchQuery = ref("");
const artifactVersions = ref<WorkspaceFileVersion[]>([]);
const previewVersion = ref<WorkspaceFileVersion | null>(null);
const diffResult = ref<Change[] | null>(null);
const versionModalOpen = ref(false);
const versionDiffIndex = ref(-1);
const versionDiffResult = ref<Change[] | null>(null);
const versionDiffLoading = ref(false);

const totalSize = computed(() => artifacts.value.reduce((sum, item) => sum + item.size, 0));
const selectedCount = computed(() => selectedPaths.value.size);
const finalArtifacts = computed(() => artifacts.value.filter((item) => item.final));
const selectedArtifacts = computed(() => artifacts.value.filter((item) => selectedPaths.value.has(item.path)));
const hasArtifactFilter = computed(() => searchQuery.value.trim().length > 0);
const filteredArtifacts = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return artifacts.value;
  return artifacts.value.filter((item) => {
    return item.path.toLowerCase().includes(query)
      || item.name.toLowerCase().includes(query)
      || item.kind.toLowerCase().includes(query)
      || item.language?.toLowerCase().includes(query);
  });
});
const visibleFinalArtifacts = computed(() => filteredArtifacts.value.filter((item) => item.final));
const visibleTotalSize = computed(() => filteredArtifacts.value.reduce((sum, item) => sum + item.size, 0));
const visibleSelectedCount = computed(() => filteredArtifacts.value.filter((item) => selectedPaths.value.has(item.path)).length);
const allVisibleSelected = computed(() => filteredArtifacts.value.length > 0 && visibleSelectedCount.value === filteredArtifacts.value.length);
const someVisibleSelected = computed(() => visibleSelectedCount.value > 0 && !allVisibleSelected.value);
const artifactGroups = computed<ArtifactGroup[]>(() => {
  const groups = new Map<string, WorkspaceArtifact[]>();
  for (const artifact of filteredArtifacts.value) {
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
  () => props.workspaceId,
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
    if (props.workspaceId) {
      void loadArtifacts();
    }
  },
);

onBeforeUnmount(() => {
  revokeImageUrl();
});

async function loadArtifacts(nextSelectedPath?: string) {
  if (!props.workspaceId) {
    artifacts.value = [];
    selectedArtifact.value = null;
    preview.value = null;
    artifactVersions.value = [];
    previewVersion.value = null;
    revokeImageUrl();
    return;
  }
  loading.value = true;
  try {
    const response = await apiClient<{ data: WorkspaceArtifact[] }>(
      `/workspaces/${props.workspaceId}/files`,
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
      artifactVersions.value = [];
      previewVersion.value = null;
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
  previewVersion.value = null;
  artifactVersions.value = [];
  const directory = getArtifactDirectory(artifact.path);
  if (collapsedFolders.value.has(directory)) {
    const next = new Set(collapsedFolders.value);
    next.delete(directory);
    collapsedFolders.value = next;
  }
  openMenuPath.value = null;
  batchMenuOpen.value = false;
  if (artifact.versionCount > 0) {
    await loadArtifactVersions(artifact);
  }
}

async function openPreview(artifact = selectedArtifact.value) {
  if (!artifact) return;
  selectedArtifact.value = artifact;
  previewVersion.value = null;
  openMenuPath.value = null;
  previewOpen.value = true;
  preview.value = null;
  revokeImageUrl();
  if (!props.workspaceId || !artifact.previewable) return;
  if (artifact.kind === "image") {
    await loadImagePreview(artifact);
    return;
  }
  previewLoading.value = true;
  try {
    const response = await apiClient<{ data: ArtifactContent }>(
      `/workspaces/${props.workspaceId}/files/content?path=${encodeURIComponent(artifact.path)}`,
    );
    preview.value = response.data;
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载预览失败");
  } finally {
    previewLoading.value = false;
  }
}

async function openVersionPreview(version: WorkspaceFileVersion) {
  const artifact = artifacts.value.find((item) => item.path === version.path) ?? selectedArtifact.value;
  if (!artifact || !props.workspaceId) return;
  selectedArtifact.value = artifact;
  previewVersion.value = version;
  openMenuPath.value = null;
  previewOpen.value = true;
  preview.value = null;
  diffResult.value = null;
  revokeImageUrl();
  previewLoading.value = true;
  try {
    const [currentRes, versionRes] = await Promise.all([
      apiClient<{ data: ArtifactContent }>(
        `/workspaces/${props.workspaceId}/files/content?path=${encodeURIComponent(version.path)}`,
      ),
      apiClient<{ data: ArtifactContent }>(
        `/workspaces/${props.workspaceId}/files/versions/content?path=${encodeURIComponent(version.path)}&versionId=${encodeURIComponent(version.id)}`,
      ),
    ]);
    const current = currentRes.data.content;
    const prev = versionRes.data.content;
    diffResult.value = diffLines(prev, current);
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载版本对比失败");
  } finally {
    previewLoading.value = false;
  }
}

async function restoreArtifactVersion(version: WorkspaceFileVersion) {
  if (!props.workspaceId) return;
  if (!window.confirm(`恢复到 ${formatTime(version.updatedAt)} 的版本？当前文件会被覆盖。`)) return;
  try {
    await apiClient<{ data: { path: string; size: number; restoredFrom: string } }>(
      `/workspaces/${props.workspaceId}/files/versions/restore`,
      {
        method: "POST",
        body: JSON.stringify({ path: version.path, versionId: version.id }),
      },
    );
    showSuccess("已恢复历史版本");
    await loadArtifacts(version.path);
    await loadArtifactVersions(artifacts.value.find((item) => item.path === version.path) ?? selectedArtifact.value);
  } catch (error) {
    showError(error instanceof Error ? error.message : "恢复版本失败");
  }
}

async function loadArtifactVersions(artifact = selectedArtifact.value) {
  if (!artifact || !props.workspaceId) {
    artifactVersions.value = [];
    return;
  }
  versionsLoading.value = true;
  try {
    const response = await apiClient<{ data: WorkspaceFileVersion[] }>(
      `/workspaces/${props.workspaceId}/files/versions?path=${encodeURIComponent(artifact.path)}`,
    );
    artifactVersions.value = response.data ?? [];
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载版本记录失败");
  } finally {
    versionsLoading.value = false;
  }
}

async function openVersionModal() {
  if (!selectedArtifact.value || !props.workspaceId) return;
  versionDiffIndex.value = -1;
  versionDiffResult.value = null;
  versionModalOpen.value = true;
  await loadArtifactVersions(selectedArtifact.value);
}

function closeVersionModal() {
  versionModalOpen.value = false;
  versionDiffIndex.value = -1;
  versionDiffResult.value = null;
}

async function showVersionDiff(index: number) {
  const version = artifactVersions.value[index];
  if (!version || !props.workspaceId) return;
  versionDiffIndex.value = index;
  versionDiffResult.value = null;
  versionDiffLoading.value = true;
  try {
    const prevIndex = index + 1;
    const prevVersion = prevIndex < artifactVersions.value.length ? artifactVersions.value[prevIndex] : version;
    const [currentRes, prevRes] = await Promise.all([
      apiClient<{ data: ArtifactContent }>(
        `/workspaces/${props.workspaceId}/files/versions/content?path=${encodeURIComponent(version.path)}&versionId=${encodeURIComponent(version.id)}`,
      ),
      apiClient<{ data: ArtifactContent }>(
        `/workspaces/${props.workspaceId}/files/versions/content?path=${encodeURIComponent(prevVersion.path)}&versionId=${encodeURIComponent(prevVersion.id)}`,
      ),
    ]);
    versionDiffResult.value = diffLines(prevRes.data.content, currentRes.data.content);
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载版本对比失败");
  } finally {
    versionDiffLoading.value = false;
  }
}

function closePreview() {
  previewOpen.value = false;
  previewVersion.value = null;
}

function copyPreviewContent() {
  const content = preview.value?.content;
  if (!content) return;
  navigator.clipboard.writeText(content).then(() => {
    showSuccess("已复制");
  }).catch(() => {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showSuccess("已复制");
  });
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
  if (!props.workspaceId || selectedPaths.value.size === 0) return;
  try {
    const blob = await postArtifactBlob(
      `/api/workspaces/${props.workspaceId}/files/download-zip`,
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
  if (!props.workspaceId || artifacts.value.length === 0) return;
  try {
    const blob = await postArtifactBlob(
      `/api/workspaces/${props.workspaceId}/files/download-zip`,
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
  if (!props.workspaceId || !target) return;
  try {
    const response = await apiClient<{ data: { title: string } }>(
      `/workspaces/${props.workspaceId}/files/import-document`,
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
  if (!props.workspaceId || selectedArtifacts.value.length === 0) return;
  let successCount = 0;
  for (const artifact of selectedArtifacts.value) {
    try {
      await apiClient<{ data: { title: string } }>(
        `/workspaces/${props.workspaceId}/files/import-document`,
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
  if (!props.workspaceId) return;
  try {
    const nextFinal = !artifact.final;
    await apiClient<{ data: { path: string; final: boolean } }>(
      `/workspaces/${props.workspaceId}/files/final`,
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
  if (!props.workspaceId || selectedArtifacts.value.length === 0) return;
  const targets = selectedArtifacts.value.filter((item) => item.final !== final);
  if (targets.length === 0) {
    batchMenuOpen.value = false;
    showSuccess(final ? "所选文件已是最终结果" : "所选文件已取消最终结果");
    return;
  }
  for (const artifact of targets) {
    try {
      await apiClient<{ data: { path: string; final: boolean } }>(
        `/workspaces/${props.workspaceId}/files/final`,
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
  if (!props.workspaceId || !target) return;
  if (!window.confirm(`删除产物"${target.path}"？`)) return;
  try {
    await apiClient<{ data: { deleted: boolean } }>(
      `/workspaces/${props.workspaceId}/files?path=${encodeURIComponent(target.path)}`,
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
  if (!props.workspaceId || selectedArtifacts.value.length === 0) return;
  if (!window.confirm(`删除选中的 ${selectedArtifacts.value.length} 个产物？`)) return;
  const targets = [...selectedArtifacts.value];
  for (const artifact of targets) {
    try {
      await apiClient<{ data: { deleted: boolean } }>(
        `/workspaces/${props.workspaceId}/files?path=${encodeURIComponent(artifact.path)}`,
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
  if (!props.workspaceId) throw new Error("没有选择工作区");
  const token = localStorage.getItem("token");
  const response = await fetch(
    `/api/workspaces/${props.workspaceId}/files/download?path=${encodeURIComponent(path)}`,
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
  selectedPaths.value = new Set(filteredArtifacts.value.map((item) => item.path));
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

function clearSearch() {
  searchQuery.value = "";
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
        <p v-if="hasArtifactFilter">{{ filteredArtifacts.length }} / {{ artifacts.length }} 个文件 · {{ formatSize(visibleTotalSize) }}</p>
        <p v-else>{{ artifacts.length }} 个文件 · {{ formatSize(totalSize) }}</p>
      </div>
      <button class="icon-btn" type="button" title="刷新" :disabled="loading" @click="loadArtifacts()">
        <SvgIcon name="refresh" :size="14" />
      </button>
    </header>

    <label v-if="workspaceId && artifacts.length > 0" class="artifact-search" @click.stop>
      <SvgIcon name="search" :size="13" />
      <input
        v-model="searchQuery"
        type="search"
        placeholder="搜索文件名、路径、类型"
      >
      <button v-if="searchQuery" type="button" title="清空搜索" @click="clearSearch">
        <SvgIcon name="close" :size="12" />
      </button>
    </label>

    <div v-if="workspaceId && artifacts.length > 0" class="bulk-actions">
      <div class="bulk-summary">
        <button
          class="artifact-checkbox"
          :class="{ checked: allVisibleSelected, partial: someVisibleSelected }"
          type="button"
          :disabled="filteredArtifacts.length === 0"
          :aria-label="allVisibleSelected ? '取消全选' : '全选'"
          @click="allVisibleSelected ? clearSelection() : selectAllArtifacts()"
        >
          <SvgIcon v-if="visibleSelectedCount > 0" name="check" :size="11" />
        </button>
        <span class="bulk-count">{{ selectedCount > 0 ? `${selectedCount} 已选` : `${filteredArtifacts.length} 个文件` }}</span>
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

    <div v-if="!workspaceId" class="empty-state">
      <SvgIcon name="folder" :size="28" />
      <p>选择工作区后查看产物</p>
    </div>
    <div v-else-if="!loading && artifacts.length === 0" class="empty-state">
      <SvgIcon name="folder" :size="28" />
      <p>暂无产物</p>
    </div>
    <div v-else-if="!loading && filteredArtifacts.length === 0" class="empty-state">
      <SvgIcon name="search" :size="28" />
      <p>未找到匹配产物</p>
    </div>
    <div v-else class="artifact-layout">
      <section v-if="visibleFinalArtifacts.length > 0" class="final-section">
        <div class="section-title">
          <span class="section-label">
            <span class="final-dot" />
            最终结果
          </span>
          <span class="section-count">{{ visibleFinalArtifacts.length }}</span>
        </div>
        <div class="final-list">
          <article
            v-for="artifact in visibleFinalArtifacts"
            :key="`final-${artifact.path}`"
            class="artifact-card final-card"
            :class="{ active: selectedArtifact?.path === artifact.path, 'menu-open': openMenuPath === artifact.path }"
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
              :class="{ active: selectedArtifact?.path === artifact.path, 'menu-open': openMenuPath === artifact.path }"
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
                <button type="button" @click="selectedArtifact = artifact; openVersionModal()">
                  <SvgIcon name="history" :size="13" />
                  版本记录
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
                <span class="meta-sep">·</span>
                <span>{{ selectedArtifact.versionCount }} 个版本</span>
                <span v-if="selectedArtifact.updatedAt" class="meta-sep">·</span>
                <span v-if="selectedArtifact.updatedAt">{{ formatTime(selectedArtifact.updatedAt) }}</span>
              </span>
            </div>
          </div>
        </div>
        <div class="detail-actions">
          <div class="detail-actions-left">
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
          <button type="button" class="version-btn" @click="openVersionModal">
            历史版本 · {{ selectedArtifact.versionCount }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── 版本历史弹窗 ── -->
    <teleport to="body">
      <div v-if="versionModalOpen" class="version-modal" @click.self="closeVersionModal">
        <section class="version-dialog">
          <header class="version-dialog-header">
            <h3>版本记录 · {{ selectedArtifact!.name }}</h3>
            <button class="icon-btn" type="button" title="关闭" @click="closeVersionModal">
              <SvgIcon name="close" :size="15" />
            </button>
          </header>
          <div class="version-dialog-body">
            <!-- 左侧列表 -->
            <aside class="version-dialog-list">
              <div v-if="versionsLoading" class="version-empty">加载中...</div>
              <div v-else-if="artifactVersions.length === 0" class="version-empty">暂无历史版本</div>
              <button
                v-else
                v-for="(version, index) in artifactVersions"
                :key="version.id"
                type="button"
                class="version-dialog-item"
                :class="{ active: versionDiffIndex === index, current: index === 0 }"
                @click="showVersionDiff(index)"
              >
                <span class="version-dialog-item-main">
                  <span>{{ index === 0 ? "当前版本" : `版本 ${artifactVersions.length - index}` }}</span>
                  <span class="version-dialog-item-size">{{ formatSize(version.size) }}</span>
                </span>
                <small>{{ formatTime(version.updatedAt) }}</small>
                <button
                  v-if="index > 0"
                  type="button"
                  class="version-dialog-restore"
                  title="恢复此版本"
                  @click.stop="restoreArtifactVersion(version)"
                >恢复</button>
              </button>
            </aside>
            <!-- 右侧 diff -->
            <div class="version-dialog-diff">
              <div v-if="versionDiffLoading" class="empty-state compact">加载中...</div>
              <div v-else-if="versionDiffResult" class="diff-view">
                <div
                  v-for="(part, i) in versionDiffResult"
                  :key="i"
                  class="diff-line"
                  :class="{ added: part.added, removed: part.removed }"
                ><span class="diff-marker">{{ part.added ? '+' : part.removed ? '-' : ' ' }}</span><span class="diff-text">{{ part.value }}</span></div>
              </div>
              <div v-else class="empty-state compact">点击左侧版本查看差异对比</div>
            </div>
          </div>
        </section>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="previewOpen && selectedArtifact" class="preview-modal" @click.self="closePreview">
        <section class="preview-dialog">
          <header class="preview-header">
            <div class="preview-title">
              <div class="preview-icon" :style="{ color: getFileColor(selectedArtifact.name) }">
                <SvgIcon :name="getFileIcon(selectedArtifact.name)" :size="18" />
              </div>
              <div>
                <strong>{{ selectedArtifact.name }}<em v-if="previewVersion"> · 历史版本</em></strong>
                <span>{{ previewVersion ? `${selectedArtifact.path} · ${formatTime(previewVersion.updatedAt)}` : selectedArtifact.path }}</span>
              </div>
            </div>
            <div class="preview-actions">
              <button class="icon-btn" type="button" title="复制内容" @click="copyPreviewContent">
                <SvgIcon name="copy" :size="14" />
              </button>
              <button class="icon-btn" type="button" title="关闭" @click="closePreview">
                <SvgIcon name="close" :size="15" />
              </button>
            </div>
          </header>
          <div class="preview-body">
            <div v-if="previewLoading" class="empty-state compact">加载中...</div>
            <div v-else-if="diffResult" class="diff-view">
              <div
                v-for="(part, i) in diffResult"
                :key="i"
                class="diff-line"
                :class="{ added: part.added, removed: part.removed }"
              ><span class="diff-marker">{{ part.added ? '+' : part.removed ? '-' : ' ' }}</span><span class="diff-text">{{ part.value }}</span></div>
            </div>
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
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.header-info p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.artifact-search {
  height: 36px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: var(--bg-surface);
  transition: all 0.2s ease;
}

.artifact-search:focus-within {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.artifact-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  font-size: var(--text-sm);
}

.artifact-search input::placeholder {
  color: var(--text-muted);
}

.artifact-search button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.artifact-search button:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.bulk-actions {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  backdrop-filter: blur(8px);
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
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.batch-menu-wrap {
  position: relative;
  flex: 0 0 auto;
  z-index: 100;
}

.batch-trigger {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s ease;
}

.batch-trigger:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.batch-menu {
  top: 32px;
  right: 0;
  z-index: 120;
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
  gap: 6px;
  overflow-y: auto;
  padding-right: 2px;
}

.artifact-folder {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folder-header {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.folder-header:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.folder-chevron {
  flex: 0 0 auto;
  transition: transform 0.2s ease;
}

.folder-chevron.collapsed {
  transform: rotate(-90deg);
}

.folder-name {
  min-width: 0;
  flex: 1;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-surface);
}

.folder-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.final-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px;
  border: 1px solid var(--border-success);
  border-radius: var(--radius-lg);
  background: var(--bg-success);
}

.final-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.final-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}

.section-count {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: 999px;
}

.artifact-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 36px 8px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.artifact-card:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
  box-shadow: var(--shadow-md);
}

.artifact-card.active {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.artifact-card.menu-open {
  z-index: 30;
}

.final-card {
  background: var(--bg-success);
  border-color: var(--border-success);
}

.final-card:hover {
  background: var(--bg-success);
  border-color: var(--border-success);
}

.final-card.active {
  background: var(--bg-success);
  border-color: var(--border-success);
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.08);
}

.file-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--bg-hover);
  transition: background 0.15s ease;
}

.artifact-card:hover .file-icon {
  background: var(--bg-hover);
}

.artifact-card.active .file-icon {
  background: var(--bg-hover);
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
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-surface);
}

.file-path {
  color: var(--text-muted);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.final-badge-inline {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--color-success);
  background: var(--bg-success);
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
  border: 1.5px solid var(--border-default);
  border-radius: 4px;
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
  overflow: hidden;
}

.artifact-checkbox:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.artifact-checkbox.checked {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.artifact-checkbox.partial {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.artifact-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.artifact-card:hover .menu-btn {
  opacity: 1;
}

.menu-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.artifact-menu {
  position: absolute;
  top: 30px;
  right: 4px;
  z-index: 80;
  min-width: 150px;
  display: grid;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-md);
}

.artifact-menu button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-sm);
  text-align: left;
  transition: all 0.12s ease;
}

.artifact-menu button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.artifact-menu button.danger {
  color: var(--color-danger);
}

.artifact-menu button.danger:hover:not(:disabled) {
  background: var(--bg-danger);
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
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  backdrop-filter: blur(8px);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.detail-icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--bg-hover);
}

.detail-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-name {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.meta-sep {
  opacity: 0.5;
}

.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}

.detail-actions-left {
  display: flex;
  gap: 5px;
}

.version-btn {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  height: auto !important;
  width: auto !important;
  border: 0 !important;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent !important;
  cursor: pointer;
  font-size: var(--text-sm);
  font-family: inherit;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.version-btn:hover {
  color: var(--text-secondary);
  background: var(--bg-hover) !important;
}

.detail-actions button {
  height: 36px;
  min-width: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s ease;
}

.detail-actions button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.detail-actions button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.detail-actions button.danger {
  color: var(--color-danger);
  border-color: var(--border-danger);
  background: var(--bg-danger);
}

.detail-actions button.danger:hover {
  background: var(--bg-danger);
  border-color: var(--border-danger);
}

.detail-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.version-empty {
  color: var(--text-muted);
  font-size: var(--text-xs);
  padding: 8px 2px;
}

/* ── 版本弹窗 ── */
.version-modal {
  position: fixed;
  inset: 0;
  z-index: 1001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(0, 0, 0, 0.6);
}

.version-dialog {
  position: relative;
  width: 1300px;
  max-width: calc(100vw - 80px);
  height: 900px;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.version-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.version-dialog-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.version-dialog-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  overflow: hidden;
}

.version-dialog-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-right: 1px solid var(--border-subtle);
}

.version-dialog-item {
  position: relative;
  min-width: 0;
  display: grid;
  gap: 1px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: var(--text-sm);
  transition: all 0.12s ease;
}

.version-dialog-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.version-dialog-item.active {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.version-dialog-item.current {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.version-dialog-item small {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.version-dialog-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-weight: var(--weight-bold);
}

.version-dialog-item-size {
  color: var(--text-muted);
  font-weight: var(--weight-normal);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
}

.version-dialog-restore {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  font-family: inherit;
  transition: all 0.12s ease;
}

.version-dialog-item:hover .version-dialog-restore {
  display: inline-flex;
}

.version-dialog-restore:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.version-dialog-diff {
  overflow: auto;
  padding: 12px;
  background: var(--bg-card);
}

/* ── 旧预览弹窗恢复 ── */
.preview-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgba(2, 6, 23, 0.6);
  backdrop-filter: blur(4px);
}

.preview-dialog {
  width: min(1040px, calc(100vw - 80px));
  height: min(760px, calc(100vh - 80px));
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.preview-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--bg-hover);
  flex-shrink: 0;
}

.preview-header div:last-child:not(.preview-title):not(.preview-actions) {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.preview-header strong {
  color: var(--text-primary);
  font-size: var(--text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-header strong em {
  color: var(--text-muted);
  font-style: normal;
  font-weight: var(--weight-bold);
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.preview-header span {
  color: var(--text-muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.preview-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 10px;
  color: var(--text-muted);
  text-align: center;
  font-size: var(--text-sm);
}

.empty-state :deep(svg) {
  opacity: 0.25;
}

.empty-state.compact {
  padding: 14px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.preview-note {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.text-preview {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

.code-preview code.hljs {
  background: transparent;
  padding: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.diff-view {
  height: 100%;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.diff-line {
  display: flex;
  padding: 0 8px;
  min-height: 18px;
}

.diff-line.added {
  background: var(--bg-success);
}

.diff-line.removed {
  background: var(--bg-danger);
}

.diff-marker {
  flex-shrink: 0;
  width: 14px;
  color: var(--text-muted);
  user-select: none;
}

.diff-text {
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
}

.diff-line.added .diff-marker {
  color: var(--color-success);
}

.diff-line.removed .diff-marker {
  color: var(--color-danger);
}
</style>
