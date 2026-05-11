<script setup lang="ts">
import SvgIcon from "./SvgIcon.vue";

export interface NavItemDef {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  active?: boolean;
}

const props = withDefaults(defineProps<{
  title: string;
  description: string;
  searchPlaceholder: string;
  searchModelValue: string;
  navDivider: string;
  navItems: NavItemDef[];
  navItemIcon?: string;
  sidebarWidth?: string | number;
  loading?: boolean;
}>(), {
  sidebarWidth: 320,
  loading: false,
});

const emit = defineEmits<{
  (e: "update:searchModelValue", value: string): void;
  (e: "search"): void;
  (e: "clearSearch"): void;
  (e: "selectNav", id: string): void;
  (e: "action"): void;
}>();
</script>

<template>
  <aside class="sidebar-panel" :style="{ width: typeof sidebarWidth === 'number' ? `${sidebarWidth}px` : sidebarWidth }">
    <div class="sidebar-header">
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
    </div>

    <div class="search-box">
      <SvgIcon name="search" class="search-icon" :size="16" />
      <input
        :value="searchModelValue"
        class="input-field search-input"
        :placeholder="searchPlaceholder"
        @input="$emit('update:searchModelValue', ($event.target as HTMLInputElement).value)"
        @keyup.enter="$emit('search')"
      />
      <button
        v-if="searchModelValue"
        class="clear-btn"
        type="button"
        title="清除搜索"
        @click="$emit('clearSearch')"
      >
        <SvgIcon name="close" :size="12" />
      </button>
    </div>

    <nav class="side-nav">
      <div class="nav-divider">{{ navDivider }}</div>

      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: item.active }"
        type="button"
        @click="$emit('selectNav', item.id)"
      >
        <div v-if="item.icon || navItemIcon" class="nav-item-icon">
          <SvgIcon :name="item.icon ?? navItemIcon!" :size="16" />
        </div>
        <div v-else class="nav-item-icon" />
        <div>
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="item.description" class="nav-desc">{{ item.description }}</span>
        </div>
      </button>

      <slot name="nav-extra" />

      <div v-if="!loading && !navItems.length" class="nav-empty">
        <slot name="empty-text">暂无数据</slot>
      </div>
    </nav>

    <div class="sidebar-actions">
      <slot name="actions" />
    </div>
  </aside>
</template>

<style scoped>
.sidebar-panel {
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 24px 16px;
}

.sidebar-header {
  margin-bottom: 16px;
  padding: 0 8px;
}

.sidebar-header h2 {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}

.sidebar-header p {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0;
}

/* Search Box */
.search-box {
  position: relative;
  margin-bottom: 12px;
  padding: 0 4px;
}

.search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.input-field.search-input {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 40px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-base);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.input-field.search-input:focus {
  border-color: var(--border-default);
}

.input-field.search-input::placeholder {
  color: var(--text-muted);
}

.clear-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
}

.clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* Nav */
.side-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-divider {
  padding: 12px 8px 6px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.nav-item.active {
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-color: var(--border-default);
}

.nav-item div:not(.nav-item-icon) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nav-label {
  font-weight: var(--weight-bold);
  font-size: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  line-clamp: 1;
  overflow: hidden;
}

.nav-item.active .nav-desc {
  color: var(--text-secondary);
}

.nav-item-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: 8px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.nav-item.active .nav-item-icon {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.nav-empty {
  padding: 20px 8px;
  font-size: var(--text-base);
  color: var(--text-muted);
  text-align: center;
}

/* Sidebar Actions */
.sidebar-actions {
  padding: 12px 4px 0;
}
</style>
