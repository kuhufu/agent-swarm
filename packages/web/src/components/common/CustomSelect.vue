<script setup lang="ts">
import { ref, computed, nextTick } from "vue";

const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "change"): void;
}>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref({});

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue);
  return opt ? opt.label : (props.placeholder ?? "请选择");
});

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    updatePosition();
  }
}

function updatePosition() {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  dropdownStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    minWidth: `${rect.width}px`,
  };
}

function select(value: string) {
  emit("update:modelValue", value);
  emit("change");
  open.value = false;
}

function close() {
  open.value = false;
}
</script>

<template>
  <div class="custom-select">
    <button ref="triggerRef" class="select-trigger" type="button" @click="toggle">
      <span class="select-value" :class="{ placeholder: !modelValue }">{{ selectedLabel }}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="select-arrow" :class="{ open }">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <Teleport to="body">
      <div v-if="open" class="select-overlay" @click="close" />
      <div v-if="open" class="select-dropdown" :style="dropdownStyle">
        <button
          v-for="opt in options"
          :key="opt.value"
          class="select-option"
          :class="{ active: opt.value === modelValue }"
          type="button"
          @click="select(opt.value)"
        >
          {{ opt.label }}
        </button>
        <div v-if="!options.length" class="select-empty">无选项</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  color: var(--color-text-primary);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.select-trigger:hover {
  border-color: var(--color-border-hover);
}

.select-trigger:focus-visible {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  outline: none;
}

.select-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-value.placeholder {
  color: var(--color-text-muted);
}

.select-arrow {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 0.2s;
}

.select-arrow.open {
  transform: rotate(180deg);
}

.select-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.select-dropdown {
  position: fixed;
  z-index: 1000;
  background: rgba(20, 22, 35, 0.98);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-select);
  padding: 4px;
  max-height: 260px;
  overflow-y: auto;
}

.select-option {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  color: var(--color-text-secondary);
  transition: background 0.1s;
}

.select-option:hover {
  background: rgba(255, 255, 255, 0.06);
}

.select-option.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.select-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
