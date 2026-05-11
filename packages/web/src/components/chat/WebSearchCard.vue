<script setup lang="ts">
import SectionLabel from "./SectionLabel.vue";
import type { WebSearchResult } from "./tool-card-utils.js";

defineProps<{
  results: WebSearchResult[];
}>();

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="search" label="搜索结果" />
    <div class="search-list">
      <article v-for="(r, i) in results" :key="i" class="search-item">
        <header class="search-item-header">
          <span class="search-index">{{ i + 1 }}</span>
          <div class="search-item-meta">
            <a class="search-title" :href="r.url" target="_blank" rel="noopener" @click.stop>{{ r.title }}</a>
            <span class="search-url">{{ hostname(r.url) }}</span>
          </div>
        </header>
        <p class="search-snippet">{{ r.snippet }}</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.search-list {
  display: grid;
  gap: 8px;
}
.search-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
}
.search-item-header {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 6px;
}
.search-index {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.16);
  color: var(--text-secondary);
  font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.search-item-meta {
  min-width: 0; flex: 1 1 auto;
}
.search-title {
  display: block;
  color: var(--text-primary);
  font-size: 13px; font-weight: 600;
  line-height: 1.35;
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: color 0.16s;
}
.search-title:hover {
  color: var(--text-secondary);
}
.search-url {
  display: block;
  color: var(--text-muted);
  font-size: 11px; margin-top: 2px;
}
.search-snippet {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px; line-height: 1.65;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
</style>
