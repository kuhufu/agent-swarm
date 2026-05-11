<script setup lang="ts">
import { ref, computed } from "vue";
import SwarmsView from "../../views/SwarmsView.vue";
import AgentsView from "../../views/AgentsView.vue";
import { useThemeStore } from "../../stores/theme.js";
import SvgIcon from "../common/SvgIcon.vue";

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const themeStore = useThemeStore();
const activeTab = ref<"swarm" | "agent" | "theme">("swarm");

const currentThemeLabel = computed(() => {
  const labels: Record<string, string> = { auto: "自动", light: "浅色", dark: "深色" };
  return labels[themeStore.mode] ?? "自动";
});
</script>

<template>
  <div v-if="open" class="ps-overlay" @click.self="emit('close')">
    <div class="ps-modal">
      <div class="ps-header">
        <h3>个人设置</h3>
        <button class="ps-close" type="button" @click="emit('close')">
          <SvgIcon name="close" :size="15" />
        </button>
      </div>
      <div class="ps-body">
        <aside class="ps-sidebar">
          <button class="ps-tab" :class="{ active: activeTab === 'swarm' }" @click="activeTab = 'swarm'">
            <SvgIcon name="swarm" :size="15" />
            <span>Swarm</span>
          </button>
          <button class="ps-tab" :class="{ active: activeTab === 'agent' }" @click="activeTab = 'agent'">
            <SvgIcon name="user" :size="15" />
            <span>Agent 预设</span>
          </button>
          <button class="ps-tab" :class="{ active: activeTab === 'theme' }" @click="activeTab = 'theme'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            <span>主题</span>
          </button>
        </aside>
        <main class="ps-content">
          <SwarmsView v-if="activeTab === 'swarm'" />
          <AgentsView v-else-if="activeTab === 'agent'" />
          <div v-else class="theme-panel">
            <h3 class="theme-panel-title">主题设置</h3>
            <div class="theme-options">
              <button
                class="theme-option"
                :class="{ active: themeStore.mode === 'auto' }"
                @click="themeStore.setMode('auto')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a10 10 0 0 0 0 20z" /></svg>
                <span class="theme-option-label">自动</span>
                <span class="theme-option-desc">跟随系统</span>
              </button>
              <button
                class="theme-option"
                :class="{ active: themeStore.mode === 'light' }"
                @click="themeStore.setMode('light')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                <span class="theme-option-label">浅色</span>
                <span class="theme-option-desc">明亮模式</span>
              </button>
              <button
                class="theme-option"
                :class="{ active: themeStore.mode === 'dark' }"
                @click="themeStore.setMode('dark')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                <span class="theme-option-label">深色</span>
                <span class="theme-option-desc">夜间模式</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ps-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.55);
  backdrop-filter: blur(4px);
}

.ps-modal {
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

.ps-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.ps-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.ps-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.ps-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.ps-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.ps-sidebar {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-right: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.08);
}

.ps-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  font-family: inherit;
}

.ps-tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
}

.ps-tab.active {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-secondary);
}

.ps-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.theme-panel {
  padding: 24px 28px;
}

.theme-panel-title {
  margin: 0 0 20px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.theme-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  font-family: inherit;
  color: var(--text-secondary);
}

.theme-option:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-default);
}

.theme-option.active {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.08);
  color: var(--text-secondary);
}

.theme-option svg {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  opacity: 0.7;
}

.theme-option.active svg {
  opacity: 1;
}

.theme-option-label {
  font-size: 14px;
  font-weight: 600;
}

.theme-option-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}
</style>
