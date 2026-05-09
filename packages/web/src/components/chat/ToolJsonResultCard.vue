<script setup lang="ts">
import SectionLabel from "./SectionLabel.vue";

defineProps<{
  details: unknown;
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="check" label="结果" />
    <pre>{{ JSON.stringify(details, null, 2) }}</pre>
  </div>
</template>

<style scoped>
pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  line-height: 1.6;
  border: 1px solid var(--color-border-subtle);
}
</style>
