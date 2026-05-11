<script setup lang="ts">
import type { SwarmConfig } from "../../types/index.js";
import { getModeConfig } from "../../constants/swarm-modes.js";
import ModeIcon from "../common/ModeIcon.vue";
import SvgIcon from "../common/SvgIcon.vue";

const props = defineProps<{
  swarm: SwarmConfig;
}>();

const emit = defineEmits<{
  (e: "click", swarm: SwarmConfig): void;
  (e: "edit", swarm: SwarmConfig): void;
  (e: "delete", swarm: SwarmConfig): void;
}>();

function handleClick() {
  emit("click", props.swarm);
}

function handleEdit(e: Event) {
  e.stopPropagation();
  emit("edit", props.swarm);
}

function handleDelete(e: Event) {
  e.stopPropagation();
  emit("delete", props.swarm);
}
</script>

<template>
  <div class="swarm-card card" @click="handleClick">
    <div class="card-header">
      <div class="mode-badge" :style="{ background: getModeConfig(swarm.mode).bg, color: getModeConfig(swarm.mode).color }">
        <ModeIcon :mode="swarm.mode" :size="14" />
        <span class="mode-label">{{ getModeConfig(swarm.mode).label }}</span>
      </div>
      <div class="card-actions">
        <button class="action-btn" @click="handleEdit">
          <SvgIcon name="edit" :size="14" />
        </button>
        <button class="action-btn danger" @click="handleDelete">
          <SvgIcon name="trash" :size="14" />
        </button>
      </div>
    </div>

    <h3 class="swarm-name">{{ swarm.name }}</h3>

    <div class="swarm-meta">
      <div class="meta-item">
        <SvgIcon name="user" :size="14" />
        <span>{{ swarm.agents.length }} 个 Agent</span>
      </div>
    </div>

    <div class="agent-tags">
      <span v-for="agent in swarm.agents" :key="agent.id" class="agent-tag">
        {{ agent.name }}
      </span>
    </div>

    <div class="card-footer">
      <span class="swarm-id">{{ swarm.id }}</span>
      <SvgIcon name="chevronRight" :size="14" style="color: var(--text-muted);" />
    </div>
  </div>
</template>

<style scoped>
.swarm-card {
  padding: 20px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}



.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.swarm-card:hover .card-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.action-btn.danger:hover {
  background: var(--bg-danger);
  color: var(--color-danger);
  border-color: var(--border-danger);
}

.swarm-name {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: -0.3px;
}

.swarm-meta {
  display: flex;
  gap: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: var(--text-base);
}

.agent-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-tag {
  padding: 4px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.swarm-id {
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
</style>
