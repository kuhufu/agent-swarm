<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../../composables/useMarkdown.js";

const props = defineProps<{
  content: string;
}>();

const renderedContent = computed(() => renderMarkdown(props.content));
</script>

<template>
  <div class="markdown-renderer" v-html="renderedContent" />
</template>

<style scoped>
.markdown-renderer {
  color: var(--text-primary);
  line-height: 1.6;
  font-size: var(--text-base);
}

.markdown-renderer :deep(pre) {
  background: var(--bg-card);
  padding: 12px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-renderer :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--text-base);
}

.markdown-renderer :deep(code:not(pre code)) {
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
}

.markdown-renderer :deep(strong) {
  color: var(--text-primary);
}

.markdown-renderer :deep(.katex) {
  color: var(--text-primary);
  font-size: 1.04em;
}

.markdown-renderer :deep(.katex-display) {
  margin: 10px 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}
</style>
