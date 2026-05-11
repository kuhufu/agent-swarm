<script setup lang="ts">
import SettingsView from "../../views/SettingsView.vue";
import SvgIcon from "../common/SvgIcon.vue";

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div v-if="open" class="sys-overlay" @click.self="emit('close')">
    <div class="sys-modal">
      <div class="sys-header">
        <h3>系统设置</h3>
        <button class="sys-close" type="button" @click="emit('close')">
          <SvgIcon name="close" :size="15" />
        </button>
      </div>
      <div class="sys-scroll">
        <SettingsView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sys-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.sys-modal {
  width: 1300px;
  height: 900px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.sys-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sys-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.sys-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.sys-close:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.sys-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
