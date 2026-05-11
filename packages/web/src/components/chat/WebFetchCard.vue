<script setup lang="ts">
import { ref } from "vue";
import SectionLabel from "./SectionLabel.vue";
import type { WebFetchResult } from "./tool-card-utils.js";

const props = defineProps<{
  result: WebFetchResult;
}>();

const showContent = ref(false);
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="file" label="抓取页面" />
    <div class="fetch-card">
      <div class="fetch-field">
        <span class="fetch-label">URL</span>
        <a class="fetch-url" :href="result.url" target="_blank" rel="noopener" @click.stop>{{ result.url }}</a>
      </div>
      <div class="fetch-field">
        <span class="fetch-label">标题</span>
        <span class="fetch-value">{{ result.title || "-" }}</span>
      </div>
      <div v-if="result.description" class="fetch-field">
        <span class="fetch-label">描述</span>
        <span class="fetch-value">{{ result.description }}</span>
      </div>
      <div class="fetch-field">
        <span class="fetch-label">类型</span>
        <span class="fetch-value fetch-type">{{ result.contentType }}</span>
      </div>
      <div class="fetch-field">
        <span class="fetch-label">内容</span>
        <span class="fetch-content-size">{{ result.content.length }} 字符</span>
        <button
          v-if="result.content"
          class="fetch-toggle"
          type="button"
          @click.stop="showContent = !showContent"
        >
          {{ showContent ? "收起" : "预览" }}
        </button>
      </div>
      <pre v-if="showContent && result.content" class="fetch-content-pre">{{ result.content }}</pre>
    </div>
  </div>
</template>

<style scoped>
.fetch-card {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
}
.fetch-field {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.fetch-label {
  color: var(--text-muted);
  font-size: 11px; font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  min-width: 36px;
}
.fetch-url, .fetch-value {
  color: var(--text-secondary);
  font-size: 12px; line-height: 1.5;
  overflow-wrap: anywhere;
  min-width: 0; flex: 1;
}
.fetch-url {
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.16s;
}
.fetch-url:hover {
  text-decoration: underline;
}
.fetch-type {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  font-family: var(--font-mono);
  font-size: 11px;
}
.fetch-content-size {
  color: var(--text-muted);
  font-size: 11px;
}
.fetch-toggle {
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.16s;
}
.fetch-toggle:hover {
  opacity: 0.75;
}
.fetch-content-pre {
  margin: 0;
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: var(--font-mono);
  font-size: 11px; line-height: 1.6;
  white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: 300px;
  overflow-y: auto;
}
</style>
