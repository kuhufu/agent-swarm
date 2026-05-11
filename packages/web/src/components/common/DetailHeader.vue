<script setup lang="ts">
import SvgIcon from "./SvgIcon.vue";

defineProps<{
  icon: string;
  title: string;
}>();
</script>

<template>
  <div class="detail-header">
    <div class="detail-title-row">
      <div class="detail-icon">
        <SvgIcon :name="icon" :size="22" />
      </div>
      <div class="detail-title-info">
        <h3 class="detail-title">{{ title }}</h3>
        <div class="detail-meta">
          <slot name="meta" />
        </div>
      </div>
    </div>
    <div class="detail-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.detail-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-title-info {
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.meta-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.detail-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
</style>
