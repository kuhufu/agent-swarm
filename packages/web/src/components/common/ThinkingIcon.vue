<script setup lang="ts">
defineProps<{
  size?: number;
}>();
</script>

<template>
  <svg :width="size ?? 14" :height="size ?? 14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V18h8v-3.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z" />
    <path d="M9 18v3" />
    <path d="M15 18v3" />
  </svg>
</template>
