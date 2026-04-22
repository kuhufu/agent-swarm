<script setup lang="ts">
defineProps<{
  mode: string;
  size?: number;
}>();
</script>

<template>
  <!-- Router -->
  <svg v-if="mode === 'router'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 12 9 6 9 18 3 12" />
    <polyline points="9 6 21 6" />
    <polyline points="9 18 21 18" />
  </svg>

  <!-- Sequential -->
  <svg v-else-if="mode === 'sequential'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.4" />
    <polyline points="10 9 13 9 13 15 10 15" />
    <circle cx="17" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.7" />
    <line x1="8" y1="12" x2="10" y2="12" />
    <polyline points="9 11 10 12 9 13" />
    <line x1="13" y1="12" x2="14" y2="12" />
    <polyline points="13 11 14 12 13 13" />
  </svg>

  <!-- Parallel -->
  <svg v-else-if="mode === 'parallel'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="4" x2="5" y2="20" />
    <polyline points="3 7 5 4 7 7" />
    <polyline points="3 17 5 20 7 17" />
    <line x1="12" y1="4" x2="12" y2="20" />
    <polyline points="10 7 12 4 14 7" />
    <polyline points="10 17 12 20 14 17" />
    <line x1="19" y1="4" x2="19" y2="20" />
    <polyline points="17 7 19 4 21 7" />
    <polyline points="17 17 19 20 21 17" />
  </svg>

  <!-- Swarm -->
  <svg v-else-if="mode === 'swarm'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="12 2 22 7 22 17 12 22 2 17 2 7" />
    <polygon points="12 6 17 8.5 17 13.5 12 16 7 13.5 7 8.5" />
    <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
  </svg>

  <!-- Debate -->
  <svg v-else-if="mode === 'debate'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <line x1="9" y1="9" x2="17" y2="9" />
    <line x1="9" y1="13" x2="14" y2="13" />
  </svg>

  <!-- Unknown / Fallback -->
  <svg v-else :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
</template>
