<script setup lang="ts">
import { computed } from "vue";
import SectionLabel from "./SectionLabel.vue";
import type { WorkspaceGrepDetails, WorkspaceGrepMatch } from "./tool-card-utils.js";

const props = defineProps<{
  details: WorkspaceGrepDetails;
}>();

const grouped = computed(() => {
  const map = new Map<string, WorkspaceGrepMatch[]>();
  for (const m of props.details.matches) {
    const list = map.get(m.path);
    if (list) {
      list.push(m);
    } else {
      map.set(m.path, [m]);
    }
  }
  return Array.from(map.entries());
});
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="search" label="搜索匹配" />
    <div class="grep-summary">
      <span>{{ details.total }} 处匹配</span>
      <span>{{ details.matchedPaths.length }} 个文件</span>
    </div>
    <div v-if="grouped.length > 0" class="grep-files">
      <div v-for="([path, matches]) in grouped" :key="path" class="grep-file-group">
        <div class="grep-file-path">{{ path }}</div>
        <div class="grep-matches">
          <div v-for="(m, i) in matches" :key="i" class="grep-match-line">
            <span class="grep-line-num">{{ m.line }}</span>
            <span class="grep-line-content">{{ m.content }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="grep-empty">无匹配结果</div>
  </div>
</template>

<style scoped>
.grep-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.grep-summary span {
  padding: 3px 8px;
  border-radius: 9999px;
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.grep-files {
  display: grid;
  gap: 8px;
}
.grep-file-group {
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}
.grep-file-path {
  padding: 7px 10px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm); font-weight: var(--weight-bold);
}
.grep-matches {
  display: grid;
}
.grep-match-line {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 8px;
  padding: 5px 10px;
  border-top: 1px solid var(--border-subtle);
  align-items: start;
}
.grep-match-line:hover {
  background: var(--bg-hover);
}
.grep-line-num {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-align: right;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
}
.grep-line-content {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.grep-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px dashed var(--border-subtle);
  font-size: var(--text-sm);
}
</style>
