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

const emit = defineEmits<{
  apply: [action: WorkspaceNextAction];
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
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-subtle);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  color: inherit;
}
.action-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
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
