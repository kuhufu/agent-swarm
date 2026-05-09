<script setup lang="ts">
import { ref } from "vue";
import SectionLabel from "./SectionLabel.vue";

interface FileInfo {
  path: string;
  size: number;
  type: "file" | "dir";
  updatedAt?: number;
}

interface ListFilesDetails {
  files: FileInfo[];
  count: number;
  totalSize: number;
  directories: string[];
}

const props = defineProps<{
  details: ListFilesDetails;
}>();

const showAll = ref(false);
const DISPLAY_LIMIT = 20;
const visibleFiles = ref(props.details.files.length > DISPLAY_LIMIT
  ? props.details.files.slice(0, DISPLAY_LIMIT)
  : props.details.files);

function toggleFiles() {
  if (showAll.value) {
    visibleFiles.value = props.details.files.slice(0, DISPLAY_LIMIT);
  } else {
    visibleFiles.value = props.details.files;
  }
  showAll.value = !showAll.value;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatTime(ts?: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="folder" label="文件列表" />
    <div class="list-summary">
      <span>{{ details.count }} 个文件</span>
      <span>{{ formatSize(details.totalSize) }}</span>
      <span>{{ details.directories.length }} 个目录</span>
    </div>
    <div class="file-table" v-if="details.files.length > 0">
      <div class="file-table-header">
        <span class="ft-col-icon" />
        <span class="ft-col-path">路径</span>
        <span class="ft-col-size">大小</span>
        <span class="ft-col-time">修改时间</span>
      </div>
      <div
        v-for="(f, i) in visibleFiles"
        :key="i"
        class="file-table-row"
        :class="{ 'is-dir': f.type === 'dir' }"
      >
        <span class="ft-col-icon ft-icon">{{ f.type === "dir" ? "📁" : "📄" }}</span>
        <span class="ft-col-path ft-path">{{ f.path }}</span>
        <span class="ft-col-size ft-size">{{ f.type === "dir" ? "-" : formatSize(f.size) }}</span>
        <span class="ft-col-time ft-time">{{ formatTime(f.updatedAt) }}</span>
      </div>
    </div>
    <div v-else class="list-empty">文件列表为空</div>
    <button
      v-if="details.files.length > DISPLAY_LIMIT"
      class="list-toggle"
      type="button"
      @click.stop="toggleFiles"
    >
      {{ showAll ? `收起 (显示 ${DISPLAY_LIMIT})` : `展开全部 (共 ${details.files.length} 项)` }}
    </button>
  </div>
</template>

<style scoped>
.list-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.list-summary span {
  padding: 3px 8px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.09);
  border: 1px solid rgba(99, 102, 241, 0.16);
  color: var(--color-text-muted);
  font-size: 11px;
}
.file-table {
  display: grid;
  gap: 2px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
}
.file-table-header, .file-table-row {
  display: grid;
  grid-template-columns: 24px 1fr 72px 80px;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  font-size: 12px;
}
.file-table-header {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: 11px; font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.file-table-row {
  background: rgba(255, 255, 255, 0.02);
  transition: background 0.12s;
}
.file-table-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.file-table-row.is-dir {
  opacity: 0.7;
}
.ft-icon {
  text-align: center;
  font-size: 13px;
  line-height: 1;
}
.ft-path {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-size, .ft-time {
  color: var(--color-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.list-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px dashed var(--color-border-subtle);
  font-size: 12px;
}
.list-toggle {
  margin-top: 8px;
  border: none;
  background: none;
  color: var(--color-accent-light);
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.16s;
}
.list-toggle:hover {
  opacity: 0.75;
}
</style>
