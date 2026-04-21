<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import CreateSwarmDialog from "../components/swarm/CreateSwarmDialog.vue";
import type { SwarmConfig } from "../types/index.js";

const swarmStore = useSwarmStore();
const showDialog = ref(false);
const editingSwarm = ref<SwarmConfig | null>(null);
const activeTab = ref<"list" | "detail">("list");
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
  activeTab.value = "detail";
}

function getModeConfig(mode: string) {
  const map: Record<string, { icon: string; label: string; color: string }> = {
    router: { icon: "🔀", label: "Router", color: "#818cf8" },
    sequential: { icon: "➡️", label: "Sequential", color: "#34d399" },
    parallel: { icon: "⏩", label: "Parallel", color: "#60a5fa" },
    swarm: { icon: "🐝", label: "Swarm", color: "#fbbf24" },
    debate: { icon: "⚖️", label: "Debate", color: "#f87171" },
  };
  return map[mode] ?? { icon: "📦", label: mode, color: "#9ca3af" };
}
</script>

<template>
  <div class="swarms-view">
    <div class="swarms-layout">
      <!-- Left Sidebar -->
      <aside class="swarms-sidebar">
        <div class="sidebar-header">
          <h2>Swarm 管理</h2>
          <p>配置多 Agent 协作集群</p>
        </div>

        <nav class="swarms-nav">
          <button
            class="nav-item"
            :class="{ active: activeTab === 'list' }"
            @click="activeTab = 'list'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <div>
              <span class="nav-label">Swarm 列表</span>
              <span class="nav-desc">{{ swarmStore.swarms.length }} 个集群</span>
            </div>
          </button>

          <div class="nav-divider">已配置</div>

          <button
            v-for="swarm in swarmStore.swarms"
            :key="swarm.id"
            class="nav-item swarm-nav-item"
            :class="{ active: activeTab === 'detail' && selectedSwarmId === swarm.id }"
            @click="handleSelect(swarm)"
          >
            <span class="swarm-nav-icon">{{ getModeConfig(swarm.mode).icon }}</span>
            <div>
              <span class="nav-label">{{ swarm.name }}</span>
              <span class="nav-desc">{{ swarm.agents.length }} 个 Agent · {{ getModeConfig(swarm.mode).label }}</span>
            </div>
          </button>
        </nav>

        <div class="sidebar-footer">
          <button class="btn-primary save-btn" @click="showDialog = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            创建 Swarm
          </button>
        </div>
      </aside>

      <!-- Right Content -->
      <main class="swarms-content">
        <!-- List Tab -->
        <div v-if="activeTab === 'list'" class="tab-panel">
          <div class="content-header">
            <h3>Swarm 列表</h3>
            <p>所有已配置的多 Agent 协作集群</p>
          </div>

          <div v-if="swarmStore.swarms.length" class="swarm-grid">
            <div
              v-for="swarm in swarmStore.swarms"
              :key="swarm.id"
              class="swarm-grid-card card"
              @click="handleSelect(swarm)"
            >
              <div class="grid-card-header">
                <span class="grid-card-icon">{{ getModeConfig(swarm.mode).icon }}</span>
                <span
                  class="badge"
                  :style="{ background: getModeConfig(swarm.mode).color + '20', color: getModeConfig(swarm.mode).color, borderColor: getModeConfig(swarm.mode).color + '30' }"
                >
                  {{ getModeConfig(swarm.mode).label }}
                </span>
              </div>
              <h4 class="grid-card-name">{{ swarm.name }}</h4>
              <p class="grid-card-agents">{{ swarm.agents.length }} 个 Agent</p>
              <div class="grid-card-actions">
                <button class="action-btn" @click.stop="handleEdit(swarm)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button class="action-btn danger" @click.stop="handleDelete(swarm)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <p class="empty-title">暂无 Swarm 配置</p>
            <p class="empty-desc">点击左侧按钮创建你的第一个 Swarm</p>
          </div>
        </div>

        <!-- Detail Tab -->
        <div v-else-if="activeTab === 'detail' && selectedSwarm" class="tab-panel">
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
        </div>
      </main>
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
  display: flex;
  height: 100%;
}

/* Left Sidebar */
.swarms-sidebar {
  width: 280px;
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 24px 16px;
}

.sidebar-header {
  margin-bottom: 20px;
  padding: 0 8px;
}

.sidebar-header h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.sidebar-header p {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.swarms-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  background: transparent;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.nav-item svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nav-label {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}

.nav-item.active .nav-desc {
  color: rgba(129, 140, 248, 0.7);
}

.nav-divider {
  padding: 12px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.swarm-nav-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.sidebar-footer {
  padding-top: 16px;
  border-top: 1px solid var(--color-border-subtle);
}

.save-btn {
  width: 100%;
}

/* Right Content */
.swarms-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

.content-header {
  margin-bottom: 24px;
}

.content-header h3 {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.content-header p {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

/* Grid Cards */
.swarm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.swarm-grid-card {
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.swarm-grid-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-hover);
}

.grid-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.grid-card-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  font-size: 18px;
}

.grid-card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}

.grid-card-agents {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0 0 14px;
}

.grid-card-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.swarm-grid-card:hover .grid-card-actions {
  opacity: 1;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.action-btn.danger:hover {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.3);
}

/* Detail View */
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
  padding: 80px 0;
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
</style>
