<script setup lang="ts">
defineProps<{
  point: string;
  message?: string;
}>();
</script>

<template>
  <div class="intervention-banner">
    <span class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
    </span>
    <span class="text">需要介入：{{ point }}</span>
    <span v-if="message" class="detail">{{ message }}</span>
  </div>
</template>

<style scoped>
.intervention-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(245, 158, 11, 0.1);
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
  font-size: var(--text-base);
  color: var(--color-warning);
}

.detail {
  color: var(--text-secondary);
}
</style>
