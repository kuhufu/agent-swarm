<script lang="ts">
export interface WikiClaim {
  text: string;
  confidence?: number;
}

export interface WikiReference {
  page: {
    id: string;
    title: string;
    summary: string;
    tags?: string[];
  };
  claims?: WikiClaim[];
  score?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeWikiReference(value: unknown): WikiReference | null {
  const raw = asRecord(value);
  const page = asRecord(raw?.page);
  if (!page) return null;
  const id = typeof page.id === "string" ? page.id : "";
  const title = typeof page.title === "string" ? page.title : "";
  const summary = typeof page.summary === "string" ? page.summary : "";
  if (!id || !title) return null;
  const claims = Array.isArray(raw?.claims)
    ? raw.claims.map((item): WikiClaim | null => {
      const claim = asRecord(item);
      const text = typeof claim?.text === "string" ? claim.text : "";
      return text ? { text, confidence: typeof claim?.confidence === "number" ? claim.confidence : undefined } : null;
    }).filter((item): item is WikiClaim => item !== null)
    : [];
  return {
    page: {
      id,
      title,
      summary,
      tags: Array.isArray(page.tags) ? page.tags.filter((item): item is string => typeof item === "string") : [],
    },
    claims,
    score: typeof raw?.score === "number" ? raw.score : undefined,
  };
}

export function extractWikiReferences(details: unknown): WikiReference[] | null {
  if (Array.isArray(details)) {
    return details.map(normalizeWikiReference).filter((item): item is WikiReference => item !== null);
  }
  return null;
}
</script>

<script setup lang="ts">
import { RouterLink } from "vue-router";
import SectionLabel from "./SectionLabel.vue";

defineProps<{
  references: WikiReference[];
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="book" label="Wiki 引用" />
    <div class="wiki-summary">{{ references.length }} 个页面</div>
    <div v-if="references.length > 0" class="wiki-list">
      <article v-for="reference in references" :key="reference.page.id" class="wiki-reference">
        <header class="wiki-reference-header">
          <RouterLink
            class="wiki-title"
            :to="{ name: 'wiki', query: { wiki: reference.page.id } }"
            @click.stop
          >
            {{ reference.page.title }}
          </RouterLink>
          <span v-if="reference.score !== undefined" class="wiki-score">{{ reference.score.toFixed(3) }}</span>
        </header>
        <p class="wiki-summary-text">{{ reference.page.summary }}</p>
        <div v-if="reference.page.tags && reference.page.tags.length > 0" class="wiki-tags">
          <span v-for="tag in reference.page.tags" :key="tag">{{ tag }}</span>
        </div>
        <ul v-if="reference.claims && reference.claims.length > 0" class="wiki-claims">
          <li v-for="claim in reference.claims.slice(0, 3)" :key="claim.text">{{ claim.text }}</li>
        </ul>
      </article>
    </div>
    <div v-else class="wiki-empty">Wiki 中没有命中相关页面</div>
  </div>
</template>

<style scoped>
.tool-section {
  margin-top: 12px;
}

.wiki-summary {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.wiki-list {
  display: grid;
  gap: 8px;
}

.wiki-reference {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
}

.wiki-reference-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.wiki-title {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 700;
  line-height: 1.4;
  text-decoration: none;
  overflow-wrap: anywhere;
}

.wiki-title:hover {
  color: var(--text-secondary);
}

.wiki-score {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.wiki-summary-text {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
}

.wiki-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.wiki-tags span {
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.16);
  font-size: var(--text-sm);
}

.wiki-claims {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.wiki-empty {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-muted);
  background: rgba(0, 0, 0, 0.18);
  border: 1px dashed var(--border-subtle);
  font-size: var(--text-sm);
}
</style>
