<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconDef } from "../../constants/icons.js";

const props = defineProps<{
  name: string;
  size?: number;
}>();

const icon = computed<IconDef | null>(() => ICONS[props.name] ?? null);
</script>

<template>
  <svg
    v-if="icon"
    :viewBox="icon.viewBox"
    :width="size ?? 20"
    :height="size ?? 20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-for="(p, i) in icon.paths" :key="i">
      <path
        :d="p.d"
        :fill="p.fill ?? 'none'"
        :stroke="p.stroke ?? 'currentColor'"
        :opacity="p.opacity"
      />
    </template>
  </svg>
</template>
