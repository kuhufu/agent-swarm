<script setup lang="ts">
import SectionLabel from "./SectionLabel.vue";
import type { WorkspaceReadFileDetails } from "./tool-card-utils.js";
import { formatSize, getWorkspaceFileKindLabel } from "./tool-card-utils.js";

defineProps<{
  details: WorkspaceReadFileDetails;
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="fileCode" label="读取文件" />
    <div class="file-card">
      <div class="file-path-row">
        <strong class="file-path">{{ details.path }}</strong>
        <span class="file-kind">{{ getWorkspaceFileKindLabel(details.meta.kind) }}{{ details.meta.language ? ` / ${details.meta.language}` : "" }}</span>
      </div>
      <div class="file-meta-row">
        <span>{{ formatSize(details.size) }}</span>
        <span v-if="details.meta.previewable" class="file-badge">可预览</span>
        <span v-if="details.truncated" class="file-badge file-badge-warn">内容过长已截断</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  display: grid;
  gap: 8px;
}
.file-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.file-path {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.file-kind {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted);
  font-size: 11px;
}
.file-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
}
.file-badge {
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.16);
  color: var(--color-accent-light);
  font-size: 10px; font-weight: 600;
}
.file-badge-warn {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.2);
  color: var(--color-warning);
}
</style>
