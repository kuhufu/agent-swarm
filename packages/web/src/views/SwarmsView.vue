<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import SwarmCard from "../components/swarm/SwarmCard.vue";
import CreateSwarmDialog from "../components/swarm/CreateSwarmDialog.vue";
import type { SwarmConfig } from "../types/index.js";

const swarmStore = useSwarmStore();
const showDialog = ref(false);
const editingSwarm = ref<SwarmConfig | null>(null);
const selectedSwarmId = ref<string | null>(null);

const selectedSwarm = computed(() =>
  swarmStore.swarms.find((s) => s.id === selectedSwarmId.value) ?? null
);

onMounted(() => {
  swarmStore.fetchSwarms();
});

function handleCreate(swarm: SwarmConfig) {
  swarmStore.createSwarm(swarm);
  showDialog.value = false;
}

function handleUpdate(swarm: SwarmConfig) {
  swarmStore.updateSwarm(swarm.id, swarm);
  editingSwarm.value = null;
  showDialog.value = false;
}

function handleEdit(swarm: SwarmConfig) {
  editingSwarm.value = swarm;
  showDialog.value = true;
}

function handleCloseDialog() {
  showDialog.value = false;
  editingSwarm.value = null;
}

function handleDelete(swarm: SwarmConfig) {
  if (confirm(`确定要删除 Swarm "${swarm.name}" 吗？`)) {
    swarmStore.removeSwarm(swarm.id);
    if (selectedSwarmId.value === swarm.id) {
      selectedSwarmId.value = null;
    }
  }
}

function handleSelect(swarm: SwarmConfig) {
  selectedSwarmId.value = swarm.id;
  swarmStore.selectSwarm(swarm);
}

function getModeConfig(mode: string) {
  const map: Record<string, { icon: string; label: string; color: string }> = {
    router: { icon: "🔀", label: "Router 路由", color: "#818cf8" },
    sequential: { icon: "➡️", label: "Sequential 顺序", color: "#34d399" },
    parallel: { icon: "⏩", label: "Parallel 并行", color: "#60a5fa" },
    swarm: { icon: "🐝", label: "Swarm 蜂群", color: "#fbbf24" },
    debate: { icon: "⚖️", label: "Debate 辩论", color: "#f87171" },
  };
  return map[mode] ?? { icon: "📦", label: mode, color: "#9ca3af" };
}
</script>

<template>
  <div class="swarms-view page-container">
    <div class="swarms-layout">
      <!-- Left: Swarm List -->
      <div class="swarm-list-panel">
        <div class="swarms-header">
          <div>
            <h2 class="section-title">Swarm 管理</h2>
            <p class="section-desc">管理和配置多 Agent 协作集群</p>
          </div>
          <button class="btn-primary" @click="showDialog = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            创建
          </button>
        </div>

        <div class="swarm-list">
          <div
            v-for="swarm in swarmStore.swarms"
            :key="swarm.id"
            class="swarm-list-item"
            :class="{ active: selectedSwarmId === swarm.id }"
            @click="handleSelect(swarm)"
          >
            <div class="item-icon">{{ getModeConfig(swarm.mode).icon }}</div>
            <div class="item-info">
              <div class="item-name">{{ swarm.name }}</div>
              <div class="item-meta">
                <span class="item-mode" :style="{ color: getModeConfig(swarm.mode).color }">
                  {{ getModeConfig(swarm.mode).label }}
                </span>
                <span class="item-agents">{{ swarm.agents.length }} 个 Agent</span>
              </div>
            </div>
          </div>

          <div v-if="swarmStore.swarms.length === 0" class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <p class="empty-title">暂无 Swarm 配置</p>
            <p class="empty-desc">点击上方按钮创建你的第一个 Swarm</p>
          </div>
        </div>
      </div>

      <!-- Right: Swarm Detail -->
      <div class="swarm-detail-panel">
        <template v-if="selectedSwarm">
          <div class="detail-header">
            <div class="detail-title-row">
              <span class="detail-mode-icon">{{ getModeConfig(selectedSwarm.mode).icon }}</span>
              <h3 class="detail-title">{{ selectedSwarm.name }}</h3>
              <span
                class="badge"
                :style="{ background: getModeConfig(selectedSwarm.mode).color + '20', color: getModeConfig(selectedSwarm.mode).color, borderColor: getModeConfig(selectedSwarm.mode).color + '30' }"
              >
                {{ getModeConfig(selectedSwarm.mode).label }}
              </span>
            </div>
            <div class="detail-actions">
              <button class="btn-secondary" @click="handleEdit(selectedSwarm)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                编辑
              </button>
              <button class="btn-danger" @click="handleDelete(selectedSwarm)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                删除
              </button>
            </div>
          </div>

          <div class="detail-section">
            <h4 class="detail-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Agent 列表 ({{ selectedSwarm.agents.length }})
            </h4>
            <div class="agent-list">
              <div v-for="agent in selectedSwarm.agents" :key="agent.id" class="agent-detail-card">
                <div class="agent-detail-header">
                  <div class="agent-avatar">{{ agent.name.charAt(0).toUpperCase() }}</div>
                  <div class="agent-detail-info">
                    <div class="agent-detail-name">{{ agent.name }}</div>
                    <div class="agent-detail-id">{{ agent.id }}</div>
                  </div>
                </div>
                <div v-if="agent.description" class="agent-detail-desc">
                  {{ agent.description }}
                </div>
                <div class="agent-detail-model">
                  <span class="model-label">模型</span>
                  <span class="model-value">{{ agent.model.provider }} / {{ agent.model.modelId }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="detail-empty">
          <div class="detail-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <p class="detail-empty-title">选择一个 Swarm</p>
          <p class="detail-empty-desc">从左侧列表选择 Swarm 查看详情</p>
        </div>
      </div>
    </div>

    <CreateSwarmDialog
      v-if="showDialog"
      :edit-swarm="editingSwarm"
      @create="handleCreate"
      @update="handleUpdate"
      @close="handleCloseDialog"
    />
  </div>
</template>

<style scoped>
.swarms-view {
  height: 100%;
  overflow: hidden;
}

.swarms-layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
  gap: 1px;
  background: var(--color-border-subtle);
}

/* Left Panel */
.swarm-list-panel {
  background: var(--color-bg-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.swarms-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 4px 0 0;
}

.swarm-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.swarm-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.swarm-list-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.swarm-list-item.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.2);
}

.item-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  font-size: 18px;
  flex-shrink: 0;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.item-mode {
  font-weight: 500;
}

.item-agents {
  color: var(--color-text-muted);
}

/* Right Panel */
.swarm-detail-panel {
  background: var(--color-bg-primary);
  overflow-y: auto;
  padding: 24px;
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.detail-mode-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  border: 1px solid var(--color-border-subtle);
  font-size: 22px;
}

.detail-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.detail-actions {
  display: flex;
  gap: 10px;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-danger:hover {
  background: rgba(248, 113, 113, 0.2);
}

.detail-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 16px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-detail-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  padding: 16px;
}

.agent-detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.agent-detail-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.agent-detail-id {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.agent-detail-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.agent-detail-model {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.model-label {
  color: var(--color-text-muted);
}

.model-value {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

/* Empty States */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 14px;
}

.empty-icon svg {
  width: 24px;
  height: 24px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}

.empty-desc {
  font-size: 13px;
  margin: 0;
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  text-align: center;
}

.detail-empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 20px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 20px;
}

.detail-empty-icon svg {
  width: 32px;
  height: 32px;
}

.detail-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 6px;
}

.detail-empty-desc {
  font-size: 14px;
  margin: 0;
}
</style>
