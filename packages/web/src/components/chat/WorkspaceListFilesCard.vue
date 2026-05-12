<script setup lang="ts">
import { computed, ref } from "vue";
import SvgIcon from "../common/SvgIcon.vue";
import SectionLabel from "./SectionLabel.vue";
import type { WorkspaceListFilesDetails } from "./tool-card-utils.js";
import { formatSize } from "./tool-card-utils.js";

const props = defineProps<{
  details: WorkspaceListFilesDetails;
}>();

const showAll = ref(false);
const DISPLAY_LIMIT = 20;
const visibleFiles = computed(() => showAll.value
  ? props.details.files
  : props.details.files.slice(0, DISPLAY_LIMIT));

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
        <span class="ft-col-icon ft-icon">
          <SvgIcon :name="f.type === 'dir' ? 'folder' : 'file'" :size="13" />
        </span>
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
      @click.stop="showAll = !showAll"
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
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.file-table {
  display: grid;
  gap: 2px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}
.file-table-header, .file-table-row {
  display: grid;
  grid-template-columns: 24px 1fr 72px 80px;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  font-size: var(--text-sm);
}
.file-table-header {
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: var(--text-sm); font-weight: var(--weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.file-table-row {
  background: var(--bg-surface);
  transition: background 0.12s;
}
.file-table-row:hover {
  background: var(--bg-hover);
}
.file-table-row.is-dir {
  opacity: 0.7;
}
.ft-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.file-table-row.is-dir .ft-icon {
  color: var(--text-secondary);
}
.ft-path {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-size, .ft-time {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.list-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px dashed var(--border-subtle);
  font-size: var(--text-sm);
}
.list-toggle {
  margin-top: 8px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: var(--text-sm); font-weight: var(--weight-bold);
  cursor: pointer;
  padding: 0;
  transition: opacity 0.16s;
}
.list-toggle:hover {
  opacity: 0.75;
}
</style>
