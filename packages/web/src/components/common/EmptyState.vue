<script setup lang="ts">
import SvgIcon from "./SvgIcon.vue";

defineProps<{
  icon: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">
      <SvgIcon :name="icon" :size="24" />
    </div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-desc">{{ description }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 80px 0;
  color: var(--text-muted);
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  margin-bottom: 14px;
  color: var(--text-muted);
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: var(--text-base);
  margin: 0;
  color: var(--text-muted);
}
</style>
