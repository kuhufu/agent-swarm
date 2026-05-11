<script setup lang="ts">
import SvgIcon from "../common/SvgIcon.vue";
import SectionLabel from "./SectionLabel.vue";
import type { WorkspaceArtifact } from "./tool-card-utils.js";
import { formatSize } from "./tool-card-utils.js";

defineProps<{
  artifact: WorkspaceArtifact;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="folder" label="产物" />
    <div class="artifact-result">
      <div>
        <strong>{{ artifact.path }}</strong>
        <span>{{ artifact.kind ?? "file" }} {{ formatSize(artifact.size) }}</span>
      </div>
      <button class="artifact-open-btn" type="button" title="查看产物" @click.stop="emit('open', artifact.path)">
        <SvgIcon name="arrowRight" :size="13" />
        查看
      </button>
    </div>
  </div>
</template>

<style scoped>
.artifact-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.artifact-result div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.artifact-result strong {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.artifact-result span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.artifact-open-btn {
  height: 28px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  transition: all 0.15s ease;
}

.artifact-open-btn:hover {
  color: var(--text-secondary);
  border-color: rgba(99, 102, 241, 0.32);
  background: rgba(99, 102, 241, 0.12);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.06);
}

.artifact-open-btn svg {
  transition: transform 0.15s ease;
}

.artifact-open-btn:hover svg {
  transform: translateX(1px);
}
</style>
