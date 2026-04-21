<script setup lang="ts">
defineProps<{
  point: string;
  message?: string;
}>();
</script>

<template>
  <div class="intervention-banner">
    <span class="icon">⚠️</span>
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
  font-size: 13px;
  color: #f59e0b;
}

.detail {
  color: #d0d0d0;
}
</style>
