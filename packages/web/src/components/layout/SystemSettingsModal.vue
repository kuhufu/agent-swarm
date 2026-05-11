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
  background: rgba(2, 6, 23, 0.55);
  backdrop-filter: blur(4px);
}

.sys-modal {
  width: 1300px;
  height: 900px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(30, 41, 59, 0.97);
  backdrop-filter: blur(20px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.sys-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.sys-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 600;
}

.sys-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.sys-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
}

.sys-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
