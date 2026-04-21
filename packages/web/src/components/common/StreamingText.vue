<script setup lang="ts">
defineProps<{
  content: string;
}>();
</script>

<template>
  <span class="streaming-text">
    {{ content }}<span class="cursor" />
  </span>
</template>

<style scoped>
.streaming-text {
  color: #d0d0d0;
}

.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: #6366f1;
  margin-left: 2px;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
