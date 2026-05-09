<script setup lang="ts">
import SectionLabel from "./SectionLabel.vue";

interface WorkspaceNextAction {
  tool: string;
  reason: string;
  params?: Record<string, unknown>;
}

defineProps<{
  actions: WorkspaceNextAction[];
}>();
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="arrowRight" label="建议下一步" />
    <div class="actions-list">
      <div v-for="(a, i) in actions" :key="i" class="action-item">
        <span class="action-tool">{{ a.tool }}</span>
        <span class="action-reason">{{ a.reason }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.actions-list {
  display: grid;
  gap: 6px;
}
.action-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-subtle);
  font-size: 12px;
}
.action-tool {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-accent-light);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}
.action-reason {
  color: var(--color-text-secondary);
  line-height: 1.4;
}
</style>
