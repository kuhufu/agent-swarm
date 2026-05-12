<script setup lang="ts">
import SectionLabel from "./SectionLabel.vue";
defineProps<{
  actions: { tool: string; reason: string; params?: Record<string, unknown> }[];
}>();

const emit = defineEmits<{
  apply: [action: { tool: string; reason: string; params?: Record<string, unknown> }];
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="arrowRight" label="建议下一步" />
    <div class="actions-list">
      <button
        v-for="(a, i) in actions"
        :key="i"
        type="button"
        class="action-btn"
        @click.stop="emit('apply', a)"
      >
        <span class="action-tool">{{ a.tool }}</span>
        <span class="action-reason">{{ a.reason }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.actions-list {
  display: grid;
  gap: 6px;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  color: inherit;
}
.action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}
.action-tool {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
.action-reason {
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
