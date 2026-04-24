<script setup lang="ts">
import { onMounted, ref, reactive, computed, watch } from "vue";
import { useSwarmStore } from "../stores/swarm.js";
import { useSettingsStore } from "../stores/settings.js";
import { useAgentStore } from "../stores/agents.js";
import { getModeConfig } from "../constants/swarm-modes.js";
import CreateSwarmDialog from "../components/swarm/CreateSwarmDialog.vue";
import ModeIcon from "../components/common/ModeIcon.vue";
import CustomSelect from "../components/common/CustomSelect.vue";
import type { SwarmConfig, SwarmAgentConfig, CollaborationMode, SavedModel, DebateConfig, PresetAgent } from "../types/index.js";
import { confirmDialog, showError } from "../utils/ui-feedback.js";

const swarmStore = useSwarmStore();
const settingsStore = useSettingsStore();
const agentStore = useAgentStore();
const showDialog = ref(false);
const selectedSwarmId = ref<string | null>(null);
const hasUnsavedChanges = ref(false);
const orchestratorId = ref("");

// Editable form state
const editForm = reactive<{
  name: string;
  mode: CollaborationMode;
  agents: SwarmAgentConfig[];
  debateConfig: DebateConfig | undefined;
  maxTotalTurns: number | undefined;
  maxConcurrency: number | undefined;
}>({
  name: "",
  mode: "router",
  agents: [],
  debateConfig: undefined,
  maxTotalTurns: undefined,
  maxConcurrency: undefined,
});

// Agent form state
const showAgentForm = ref(false);
const editingAgentIndex = ref<number | null>(null);
const selectedPresetId = ref("");
const draggingAgentIndex = ref<number | null>(null);
const dragOverAgentIndex = ref<number | null>(null);
const suppressAgentClick = ref(false);
const agentForm = reactive<SwarmAgentConfig>({
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  model: { provider: "", modelId: "" },
});
const showCustomModel = ref(false);

const selectedSwarm = computed(() =>
  swarmStore.swarms.find((s) => s.id === selectedSwarmId.value) ?? null
);

const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);
const presetAgentOptions = computed(() => [
  { value: "", label: "不使用预设模板" },
  ...agentStore.sortedPresets.map((preset) => ({
    value: preset.id,
    label: `${preset.name}${preset.category ? ` · ${preset.category}` : ""}${preset.builtIn ? " · 内置" : ""}`,
  })),
]);
const routerOrchestratorOptions = computed(() => {
  if (!editForm.agents.length) {
    return [{ value: "", label: "请先添加 Agent" }];
  }
  return editForm.agents.map((agent) => ({
    value: agent.id,
    label: `${agent.name} (${agent.id})`,
  }));
});

const modes: { value: CollaborationMode; label: string; desc: string; icon: string }[] = [
  { value: "router", label: "Router 路由", desc: "智能路由到最合适的 Agent", icon: "🔀" },
  { value: "sequential", label: "Sequential 顺序", desc: "按顺序依次执行", icon: "➡️" },
  { value: "parallel", label: "Parallel 并行", desc: "多个 Agent 同时执行", icon: "⏩" },
  { value: "swarm", label: "Swarm 蜂群", desc: "去中心化协作", icon: "🐝" },
  { value: "debate", label: "Debate 辩论", desc: "多 Agent 辩论模式", icon: "⚖️" },
];

function ensureSelectedSwarm() {
  if (!swarmStore.swarms.length) {
    selectedSwarmId.value = null;
    swarmStore.clearSwarmSelection();
    return;
  }

  if (selectedSwarmId.value && swarmStore.swarms.some((swarm) => swarm.id === selectedSwarmId.value)) {
    return;
  }

  const firstSwarm = swarmStore.swarms[0];
  if (!firstSwarm) {
    return;
  }

  selectedSwarmId.value = firstSwarm.id;
  swarmStore.selectSwarm(firstSwarm);
}

onMounted(async () => {
  await swarmStore.fetchSwarms();
  ensureSelectedSwarm();
  settingsStore.fetchConfig();
  agentStore.fetchAgents();
});

watch(
  () => swarmStore.swarms.map((swarm) => swarm.id),
  () => {
    ensureSelectedSwarm();
  },
  { immediate: true },
);

function normalizeAgentId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "agent";
}

function buildUniqueAgentId(baseId: string, excludeIndex: number | null): string {
  const normalizedBase = normalizeAgentId(baseId);
  let candidate = normalizedBase;
  let suffix = 2;
  const conflict = (id: string) => editForm.agents.some((agent, index) => index !== excludeIndex && agent.id === id);
  while (conflict(candidate)) {
    candidate = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function applyPresetToAgentForm(preset: PresetAgent) {
  const editingIndex = editingAgentIndex.value;
  if (editingIndex === null) {
    agentForm.id = buildUniqueAgentId(preset.id, null);
  }
  agentForm.name = preset.name;
  agentForm.description = preset.description;
  agentForm.systemPrompt = preset.systemPrompt;
  agentForm.model.provider = preset.model.provider;
  agentForm.model.modelId = preset.model.modelId;
  showCustomModel.value = savedModels.value.every(
    (sm) => !(sm.provider === preset.model.provider && sm.modelId === preset.model.modelId),
  );
}

function handlePresetSelection(value: string) {
  selectedPresetId.value = value;
  if (!value) {
    return;
  }
  const preset = agentStore.sortedPresets.find((item) => item.id === value);
  if (!preset) {
    return;
  }
  applyPresetToAgentForm(preset);
}

function syncRouterOrchestrator(preferredId?: string) {
  if (preferredId && editForm.agents.some((agent) => agent.id === preferredId)) {
    orchestratorId.value = preferredId;
    return;
  }
  if (editForm.agents.some((agent) => agent.id === orchestratorId.value)) {
    return;
  }
  orchestratorId.value = editForm.agents[0]?.id ?? "";
}

function reorderAgents(fromIndex: number, toIndex: number): boolean {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= editForm.agents.length
    || toIndex >= editForm.agents.length
  ) {
    return false;
  }

  const [moved] = editForm.agents.splice(fromIndex, 1);
  if (!moved) {
    return false;
  }
  editForm.agents.splice(toIndex, 0, moved);
  return true;
}

function updateEditingIndexAfterReorder(fromIndex: number, toIndex: number) {
  if (editingAgentIndex.value === null) {
    return;
  }
  const currentEditingIndex = editingAgentIndex.value;
  if (currentEditingIndex === fromIndex) {
    editingAgentIndex.value = toIndex;
    return;
  }
  if (fromIndex < currentEditingIndex && toIndex >= currentEditingIndex) {
    editingAgentIndex.value = currentEditingIndex - 1;
    return;
  }
  if (fromIndex > currentEditingIndex && toIndex <= currentEditingIndex) {
    editingAgentIndex.value = currentEditingIndex + 1;
  }
}

function handleAgentDragStart(index: number, event: DragEvent) {
  draggingAgentIndex.value = index;
  dragOverAgentIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }
}

function handleAgentDragOver(index: number, event: DragEvent) {
  if (draggingAgentIndex.value === null) {
    return;
  }
  event.preventDefault();
  if (dragOverAgentIndex.value !== index) {
    dragOverAgentIndex.value = index;
  }
}

function handleAgentDrop(index: number, event: DragEvent) {
  event.preventDefault();
  const fromIndex = draggingAgentIndex.value;
  if (fromIndex === null) {
    return;
  }

  if (reorderAgents(fromIndex, index)) {
    updateEditingIndexAfterReorder(fromIndex, index);
    syncRouterOrchestrator(orchestratorId.value);
    markDirty();
    suppressAgentClick.value = true;
  }
  draggingAgentIndex.value = null;
  dragOverAgentIndex.value = null;
}

function handleAgentDragEnd() {
  draggingAgentIndex.value = null;
  dragOverAgentIndex.value = null;
}

function handleAgentCardClick(index: number) {
  if (suppressAgentClick.value) {
    suppressAgentClick.value = false;
    return;
  }
  startEditAgent(index);
}

// Sync form with selected swarm
watch(selectedSwarm, (swarm) => {
  if (swarm) {
    editForm.name = swarm.name;
    editForm.mode = swarm.mode;
    editForm.agents = swarm.agents.map((a) => ({ ...a, model: { ...a.model } }));
    editForm.debateConfig = swarm.debateConfig ? { ...swarm.debateConfig } : undefined;
    editForm.maxTotalTurns = swarm.maxTotalTurns;
    editForm.maxConcurrency = swarm.maxConcurrency;
    syncRouterOrchestrator(swarm.orchestrator?.id);
    hasUnsavedChanges.value = false;
  }
}, { immediate: true });

watch(() => editForm.mode, () => {
  syncRouterOrchestrator();
});

function markDirty() {
  hasUnsavedChanges.value = true;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "未知错误";
}

async function handleCreate(swarm: SwarmConfig) {
  try {
    await swarmStore.createSwarm(swarm);
    showDialog.value = false;
  } catch (error) {
    alert(`创建失败：${getErrorMessage(error)}`);
  }
}

function handleSelect(swarm: SwarmConfig) {
  if (hasUnsavedChanges.value && selectedSwarmId.value !== swarm.id) {
    if (!confirm("当前有未保存的修改，确定切换吗？")) return;
  }
  selectedSwarmId.value = swarm.id;
  swarmStore.selectSwarm(swarm);
  resetAgentForm();
}

async function handleDelete(swarm: SwarmConfig) {
  const confirmed = await confirmDialog({
    header: "删除 Swarm",
    body: `确定要删除 Swarm "${swarm.name}" 吗？`,
    confirmText: "删除",
    cancelText: "取消",
    theme: "danger",
  });
  if (!confirmed) {
    return;
  }

  try {
    await swarmStore.removeSwarm(swarm.id);
    if (selectedSwarmId.value === swarm.id) {
      selectedSwarmId.value = null;
    }
    hasUnsavedChanges.value = false;
  } catch (error) {
    showError(`删除失败：${getErrorMessage(error)}`);
  }
}

async function handleSave() {
  if (!selectedSwarmId.value || !editForm.name || !editForm.agents.length) return;
  const orchestrator = editForm.mode === "router"
    ? editForm.agents.find((agent) => agent.id === orchestratorId.value) ?? editForm.agents[0]
    : undefined;
  const updated: SwarmConfig = {
    id: selectedSwarmId.value,
    name: editForm.name,
    mode: editForm.mode,
    agents: editForm.agents.map((a) => ({ ...a, model: { ...a.model } })),
    debateConfig: editForm.mode === "debate" ? editForm.debateConfig : undefined,
    maxTotalTurns: editForm.maxTotalTurns,
    maxConcurrency: editForm.maxConcurrency,
  };
  if (orchestrator) {
    updated.orchestrator = { ...orchestrator, model: { ...orchestrator.model } };
  }
  if (editForm.mode === "debate" && !updated.debateConfig) {
    updated.debateConfig = {
      rounds: 3,
      proAgent: editForm.agents[0]?.id ?? "",
      conAgent: editForm.agents[1]?.id ?? editForm.agents[0]?.id ?? "",
      judgeAgent: editForm.agents[0]?.id ?? "",
    };
  }
  try {
    await swarmStore.updateSwarm(selectedSwarmId.value, updated);
    hasUnsavedChanges.value = false;
  } catch (error) {
    alert(`保存失败：${getErrorMessage(error)}`);
  }
}

// Agent form operations
function resetAgentForm() {
  showAgentForm.value = false;
  editingAgentIndex.value = null;
  selectedPresetId.value = "";
  agentForm.id = "";
  agentForm.name = "";
  agentForm.description = "";
  agentForm.systemPrompt = "";
  agentForm.model = { provider: "", modelId: "" };
  showCustomModel.value = false;
}

function startAddAgent() {
  resetAgentForm();
  showAgentForm.value = true;
}

function startEditAgent(index: number) {
  const agent = editForm.agents[index];
  if (!agent) return;
  editingAgentIndex.value = index;
  selectedPresetId.value = "";
  agentForm.id = agent.id;
  agentForm.name = agent.name;
  agentForm.description = agent.description;
  agentForm.systemPrompt = agent.systemPrompt;
  agentForm.model = { ...agent.model };
  showAgentForm.value = true;
  showCustomModel.value = savedModels.value.every(
    (sm) => !(sm.provider === agent.model.provider && sm.modelId === agent.model.modelId)
  );
}

function submitAgent() {
  if (!agentForm.id || !agentForm.name) return;
  const agentData: SwarmAgentConfig = { ...agentForm, model: { ...agentForm.model } };
  if (editingAgentIndex.value !== null) {
    editForm.agents[editingAgentIndex.value] = agentData;
  } else {
    editForm.agents.push(agentData);
  }
  syncRouterOrchestrator();
  resetAgentForm();
  markDirty();
}

function removeAgent(index: number) {
  editForm.agents.splice(index, 1);
  syncRouterOrchestrator();
  if (editingAgentIndex.value === index) resetAgentForm();
  markDirty();
}

function selectModelForAgent(model: SavedModel) {
  agentForm.model.provider = model.provider;
  agentForm.model.modelId = model.modelId;
  showCustomModel.value = false;
}

function clearModelSelection() {
  agentForm.model.provider = "";
  agentForm.model.modelId = "";
  showCustomModel.value = true;
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

        <button class="btn-primary create-btn" @click="showDialog = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          创建 Swarm
        </button>

        <div class="swarm-section">
          <div class="swarm-section-title">已配置 Swarm</div>
          <nav class="swarms-nav">
            <button
              v-for="swarm in swarmStore.swarms"
              :key="swarm.id"
              class="swarm-item"
              :class="{ active: selectedSwarmId === swarm.id }"
              @click="handleSelect(swarm)"
            >
              <div class="swarm-item-top">
                <span class="swarm-nav-icon"><ModeIcon :mode="swarm.mode" /></span>
                <span class="swarm-name">{{ swarm.name }}</span>
              </div>
              <span class="swarm-meta">{{ swarm.agents.length }} 个 Agent · {{ getModeConfig(swarm.mode).label }}</span>
            </button>

            <div v-if="!swarmStore.swarms.length" class="nav-empty">
              暂无 Swarm
            </div>
          </nav>
        </div>
      </aside>

      <!-- Right Content -->
      <main class="swarms-content">
        <!-- No selection -->
        <div v-if="!selectedSwarm" class="detail-card empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <p class="empty-title">选择或创建一个 Swarm</p>
          <p class="empty-desc">点击左侧 Swarm 项查看并编辑配置</p>
        </div>

        <!-- Editable Detail -->
        <div v-else class="detail-card detail-panel">
          <div class="detail-header">
            <div class="detail-title-row">
              <span class="detail-mode-icon"><ModeIcon :mode="editForm.mode" :size="22" /></span>
              <div class="detail-title-input-wrap">
                <input
                  v-model="editForm.name"
                  class="detail-title-input"
                  placeholder="Swarm 名称"
                  @input="markDirty"
                />
              </div>
              <span
                class="badge"
                :style="{ background: getModeConfig(editForm.mode).color + '20', color: getModeConfig(editForm.mode).color, borderColor: getModeConfig(editForm.mode).color + '30' }"
              >
                {{ getModeConfig(editForm.mode).label }}
              </span>
            </div>
            <div class="detail-actions">
              <button class="btn-primary" :disabled="!hasUnsavedChanges || !editForm.name || !editForm.agents.length" @click="handleSave">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                保存
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

          <!-- Mode Selection -->
          <div class="detail-section">
            <h4 class="detail-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              协作模式
            </h4>
            <div class="mode-grid">
              <div
                v-for="m in modes"
                :key="m.value"
                class="mode-option"
                :class="{ active: editForm.mode === m.value }"
                @click="editForm.mode = m.value; markDirty()"
              >
                <span class="mode-icon"><ModeIcon :mode="m.value" /></span>
                <div class="mode-info">
                  <span class="mode-name">{{ m.label }}</span>
                  <span class="mode-desc">{{ m.desc }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Router Config -->
          <div v-if="editForm.mode === 'router'" class="detail-section">
            <h4 class="detail-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <circle cx="12" cy="12" r="10" />
                <path d="M16 8l-8 8" />
                <path d="M8 8h8v8" />
              </svg>
              路由配置
            </h4>
            <div class="router-config card">
              <div class="form-row">
                <label>Orchestrator</label>
                <CustomSelect
                  :model-value="orchestratorId"
                  :options="routerOrchestratorOptions"
                  placeholder="选择路由 Agent"
                  @update:model-value="orchestratorId = $event; markDirty()"
                />
              </div>
              <p class="router-config-hint">Router 模式会由该 Agent 先接收请求并决定路由目标。</p>
            </div>
          </div>

          <!-- Debate Config -->
          <div v-if="editForm.mode === 'debate'" class="detail-section">
            <h4 class="detail-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              辩论配置
            </h4>
            <div class="debate-config card">
              <div class="form-row">
                <label>辩论轮数</label>
                <input
                  type="number"
                  :value="editForm.debateConfig?.rounds ?? 3"
                  class="input-field"
                  min="1"
                  max="20"
                  style="width: 100px;"
                  @input="editForm.debateConfig = { ...editForm.debateConfig ?? { rounds: 3, proAgent: '', conAgent: '', judgeAgent: '' }, rounds: Number(($event.target as HTMLInputElement).value) || 3 }; markDirty()"
                />
              </div>
              <div class="form-row">
                <label>正方 Agent</label>
                <CustomSelect
                  :model-value="editForm.debateConfig?.proAgent ?? ''"
                  :options="[{ value: '', label: '选择 Agent' }, ...editForm.agents.map(a => ({ value: a.id, label: `${a.name} (${a.id})` }))]"
                  @update:model-value="editForm.debateConfig = { ...editForm.debateConfig ?? { rounds: 3, proAgent: '', conAgent: '', judgeAgent: '' }, proAgent: $event }; markDirty()"
                />
              </div>
              <div class="form-row">
                <label>反方 Agent</label>
                <CustomSelect
                  :model-value="editForm.debateConfig?.conAgent ?? ''"
                  :options="[{ value: '', label: '选择 Agent' }, ...editForm.agents.map(a => ({ value: a.id, label: `${a.name} (${a.id})` }))]"
                  @update:model-value="editForm.debateConfig = { ...editForm.debateConfig ?? { rounds: 3, proAgent: '', conAgent: '', judgeAgent: '' }, conAgent: $event }; markDirty()"
                />
              </div>
              <div class="form-row">
                <label>裁判 Agent</label>
                <CustomSelect
                  :model-value="editForm.debateConfig?.judgeAgent ?? ''"
                  :options="[{ value: '', label: '选择 Agent' }, ...editForm.agents.map(a => ({ value: a.id, label: `${a.name} (${a.id})` }))]"
                  @update:model-value="editForm.debateConfig = { ...editForm.debateConfig ?? { rounds: 3, proAgent: '', conAgent: '', judgeAgent: '' }, judgeAgent: $event }; markDirty()"
                />
              </div>
            </div>
          </div>

          <!-- Agents Section -->
          <div class="detail-section">
            <div class="section-header">
              <h4 class="detail-section-title" style="margin-bottom: 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Agent 列表 ({{ editForm.agents.length }})
              </h4>
              <button class="btn-secondary compact-btn" @click="startAddAgent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加 Agent
              </button>
            </div>

            <!-- Agent Form Dialog -->
            <Teleport to="body">
              <div v-if="showAgentForm" class="dialog-overlay" @click.self="resetAgentForm">
                <div class="agent-dialog">
                  <div class="dialog-header">
                    <h3>{{ editingAgentIndex !== null ? '编辑 Agent' : '添加 Agent' }}</h3>
                    <button class="close-btn" @click="resetAgentForm">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                  <div class="dialog-body">
                    <div v-if="agentStore.sortedPresets.length > 0" class="form-row">
                      <label>预设模板</label>
                      <CustomSelect
                        :model-value="selectedPresetId"
                        :options="presetAgentOptions"
                        placeholder="选择已有 Agent 模板"
                        @update:model-value="handlePresetSelection"
                      />
                    </div>
                    <div class="form-row">
                      <label>ID</label>
                      <input v-model="agentForm.id" class="input-field" placeholder="agent-1" :disabled="editingAgentIndex !== null" />
                    </div>
                    <div class="form-row">
                      <label>名称</label>
                      <input v-model="agentForm.name" class="input-field" placeholder="Agent 1" />
                    </div>
                    <div class="form-row">
                      <label>描述</label>
                      <input v-model="agentForm.description" class="input-field" placeholder="负责..." />
                    </div>
                    <div class="form-row">
                      <label>System Prompt</label>
                      <textarea v-model="agentForm.systemPrompt" class="input-field" placeholder="你是一个..." rows="3" />
                    </div>
                    <div v-if="savedModels.length > 0" class="model-selection">
                      <label class="form-label" style="margin-bottom: 8px;">选择模型</label>
                      <div class="model-chips">
                        <button v-for="sm in savedModels" :key="sm.id" class="model-chip" :class="{ active: agentForm.model.provider === sm.provider && agentForm.model.modelId === sm.modelId }" @click="selectModelForAgent(sm)">{{ sm.name }}</button>
                        <button class="model-chip" :class="{ active: showCustomModel }" @click="clearModelSelection">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          自定义
                        </button>
                      </div>
                    </div>
                    <div v-if="showCustomModel || savedModels.length === 0" class="custom-model-fields">
                      <div class="form-row">
                        <label>Provider</label>
                        <input v-model="agentForm.model.provider" class="input-field" placeholder="anthropic" />
                      </div>
                      <div class="form-row">
                        <label>模型</label>
                        <input v-model="agentForm.model.modelId" class="input-field" placeholder="claude-sonnet-4-20250514" />
                      </div>
                    </div>
                  </div>
                  <div class="dialog-footer">
                    <button class="btn-secondary" @click="resetAgentForm">取消</button>
                    <button class="btn-primary" :disabled="!agentForm.id || !agentForm.name" @click="submitAgent">
                      {{ editingAgentIndex !== null ? '保存修改' : '确认添加' }}
                    </button>
                  </div>
                </div>
              </div>
            </Teleport>

            <!-- Agent List -->
            <div v-if="editForm.agents.length" class="agent-list">
              <div
                v-for="(agent, i) in editForm.agents"
                :key="agent.id"
                class="agent-edit-card"
                :class="{
                  dragging: draggingAgentIndex === i,
                  'drag-over': dragOverAgentIndex === i && draggingAgentIndex !== i,
                }"
                draggable="true"
                @click="handleAgentCardClick(i)"
                @dragstart="handleAgentDragStart(i, $event)"
                @dragover="handleAgentDragOver(i, $event)"
                @drop="handleAgentDrop(i, $event)"
                @dragend="handleAgentDragEnd"
              >
                <div class="agent-info">
                  <div class="agent-avatar">{{ agent.name.charAt(0).toUpperCase() }}</div>
                  <div>
                    <span class="agent-name">{{ agent.name }}</span>
                    <span class="agent-desc">{{ agent.description || agent.id }}</span>
                    <span v-if="agent.model.provider || agent.model.modelId" class="agent-model">
                      {{ agent.model.provider }} / {{ agent.model.modelId }}
                    </span>
                  </div>
                </div>
                <div class="agent-card-actions">
                  <button class="action-btn" @click.stop="startEditAgent(i)" title="编辑">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button class="action-btn danger" @click.stop="removeAgent(i)" title="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="agent-empty">
              <p>还没有 Agent，点击上方按钮添加</p>
            </div>
          </div>
        </div>
      </main>
    </div>

    <CreateSwarmDialog
      v-if="showDialog"
      @create="handleCreate"
      @close="showDialog = false"
    />
  </div>
</template>

<style scoped>
.swarms-view {
  height: 100%;
}

.swarms-layout {
  display: flex;
  height: 100%;
}

.swarms-sidebar {
  width: 280px;
  border-right: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-header h2 {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.sidebar-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.create-btn {
  width: 100%;
}

.swarm-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.swarm-section-title {
  margin-top: 6px;
  padding: 0 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.swarms-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}

.swarm-item {
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.swarm-item:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.05);
}

.swarm-item.active {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.swarm-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.swarm-nav-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.swarm-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swarm-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}

.swarm-item.active .swarm-meta {
  color: rgba(129, 140, 248, 0.8);
}

.nav-empty {
  padding: 10px 12px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.swarms-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px;
}

.detail-card {
  max-width: 960px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  padding: 20px;
}

.empty-state {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
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
  margin: 0 0 4px;
  color: var(--color-text-secondary);
  font-size: 15px;
  font-weight: 600;
}

.empty-desc {
  margin: 0;
  font-size: 13px;
}

.detail-panel {
  max-width: 960px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 18px;
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.detail-mode-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  border: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.detail-title-input-wrap {
  flex: 1;
  min-width: 0;
}

.detail-title-input {
  width: 100%;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 4px 8px;
  margin: -4px -8px;
  transition: all 0.2s;
  outline: none;
}

.detail-title-input:hover {
  border-color: var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
}

.detail-title-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.05);
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.detail-section {
  margin-bottom: 22px;
}

.detail-section:last-child {
  margin-bottom: 0;
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

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.compact-btn {
  padding: 6px 12px;
  font-size: 13px;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-option:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.mode-option.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
}

.mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.mode-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.mode-desc {
  font-size: 11px;
  color: var(--color-text-muted);
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: transparent;
  backdrop-filter: none;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.agent-dialog {
  width: 480px;
  max-height: 85vh;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-default);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.38),
    0 8px 20px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(99, 102, 241, 0.16);
}

.agent-dialog .dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 0;
}

.agent-dialog .dialog-header h3 {
  color: var(--color-text-primary);
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.agent-dialog .dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
}

.agent-dialog .dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--color-border-subtle);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.close-btn svg {
  width: 16px;
  height: 16px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.form-label {
  display: block;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

textarea.input-field {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.model-selection {
  margin-bottom: 12px;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-chip {
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.model-chip:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.model-chip.active {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.14);
  color: var(--color-accent-light);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-edit-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  cursor: grab;
  transition: all 0.2s;
}

.agent-edit-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-hover);
}

.agent-edit-card.dragging {
  opacity: 0.58;
  border-color: rgba(99, 102, 241, 0.45);
  background: rgba(99, 102, 241, 0.08);
  cursor: grabbing;
}

.agent-edit-card.drag-over {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.12);
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
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

.agent-name {
  display: block;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.agent-desc {
  display: block;
  color: var(--color-text-muted);
  font-size: 12px;
}

.agent-model {
  display: block;
  color: var(--color-accent-light);
  font-size: 11px;
  font-family: var(--font-mono);
  margin-top: 2px;
}

.agent-card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.agent-edit-card:hover .agent-card-actions {
  opacity: 1;
}

.action-btn {
  width: 30px;
  height: 30px;
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

.debate-config {
  padding: 14px;
}

.router-config {
  padding: 14px;
}

.router-config-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.agent-empty {
  text-align: center;
  padding: 24px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
}

.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

.card:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--color-border-subtle);
  transform: none;
  box-shadow: none;
}

@media (max-width: 1024px) {
  .swarms-layout {
    flex-direction: column;
  }

  .swarms-sidebar {
    width: 100%;
    max-height: 280px;
    border-right: none;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .swarms-content {
    padding: 16px;
  }

  .detail-header {
    flex-direction: column;
    align-items: stretch;
  }

  .detail-actions {
    justify-content: flex-start;
  }

  .mode-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .agent-dialog {
    width: 100%;
    max-width: 520px;
  }
}
</style>
