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
  color: #d0d0d0;
  line-height: 1.6;
  font-size: 14px;
}

.markdown-renderer :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-renderer :deep(code) {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 13px;
}

.markdown-renderer :deep(code:not(pre code)) {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.markdown-renderer :deep(strong) {
  color: #e0e0e0;
}

.markdown-renderer :deep(.katex) {
  color: #f8fafc;
  font-size: 1.04em;
}

.markdown-renderer :deep(.katex-display) {
  margin: 10px 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}
</style>
