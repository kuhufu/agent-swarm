<script setup lang="ts">
import SvgIcon from "../common/SvgIcon.vue";

defineProps<{
  icon: string;
  label: string;
}>();
</script>

<template>
  <span class="section-label">
    <SvgIcon :name="icon" :size="12" />
    {{ label }}
  </span>
</template>

<style scoped>
.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
</style>
