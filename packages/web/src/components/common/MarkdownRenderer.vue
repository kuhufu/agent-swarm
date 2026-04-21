<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  content: string;
}>();

function renderMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Line breaks
    .replace(/\n/g, "<br>");
}

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
</style>
