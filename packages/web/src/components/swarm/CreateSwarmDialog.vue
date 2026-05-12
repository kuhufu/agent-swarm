<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useSettingsStore } from "../../stores/settings.js";
import { useAgentStore } from "../../stores/agents.js";
import { MODE_OPTIONS } from "../../constants/swarm-modes.js";
import type { AggregationStrategy } from "../../types/index.js";
import type { SwarmConfig, SwarmAgentConfig, CollaborationMode, SavedModel, PresetAgent } from "../../types/index.js";
import ModeIcon from "../common/ModeIcon.vue";
import CustomSelect from "../common/CustomSelect.vue";
import SvgIcon from "../common/SvgIcon.vue";

const emit = defineEmits<{
  (e: "create", swarm: SwarmConfig): void;
  (e: "close"): void;
}>();

const modes = MODE_OPTIONS;

const name = ref("");
const mode = ref<CollaborationMode>("router");
const agents = reactive<SwarmAgentConfig[]>([]);
const orchestratorId = ref("");
const aggregatorType = ref<AggregationStrategy["type"]>("none");
const aggregatorQuorum = ref(2);
const aggregatorJudgeAgent = ref("");

const showAgentForm = ref(false);
const selectedPresetId = ref("");
const draggingAgentIndex = ref<number | null>(null);
const dragOverAgentIndex = ref<number | null>(null);
const agentForm = reactive<SwarmAgentConfig>({
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  model: { provider: "", modelId: "" },
});
const showCustomModel = ref(false);

const settingsStore = useSettingsStore();
const agentStore = useAgentStore();
const savedModels = computed<SavedModel[]>(() => settingsStore.models);
const presetAgentOptions = computed(() => [
  { value: "", label: "不使用预设模板" },
  ...agentStore.sortedPresets.map((preset) => ({
    value: preset.id,
    label: `${preset.name}${preset.category ? ` · ${preset.category}` : ""}${preset.builtIn ? " · 内置" : ""}`,
  })),
]);
const orchestratorOptions = computed(() => {
  if (!agents.length) {
    return [{ value: "", label: "请先添加 Agent" }];
  }
  return agents.map((agent) => ({
    value: agent.id,
    label: `${agent.name} (${agent.id})`,
  }));
});

function syncOrchestrator(preferredId?: string) {
  if (preferredId && agents.some((agent) => agent.id === preferredId)) {
    orchestratorId.value = preferredId;
    return;
  }
  if (agents.some((agent) => agent.id === orchestratorId.value)) {
    return;
  }
  orchestratorId.value = agents[0]?.id ?? "";
}

function setMode(nextMode: CollaborationMode) {
  mode.value = nextMode;
  syncOrchestrator();
}

function selectModelForAgent(model: SavedModel) {
  agentForm.model.provider = model.provider;
  agentForm.model.modelId = model.modelId;
  showCustomModel.value = false;
}

function normalizeAgentId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "agent";
}

function buildUniqueAgentId(baseId: string): string {
  const normalizedBase = normalizeAgentId(baseId);
  let candidate = normalizedBase;
  let suffix = 2;
  while (agents.some((agent) => agent.id === candidate)) {
    candidate = `${normalizedBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function applyPresetToForm(preset: PresetAgent) {
  agentForm.id = buildUniqueAgentId(preset.id);
  agentForm.name = preset.name;
  agentForm.description = preset.description;
  agentForm.systemPrompt = preset.systemPrompt;
  agentForm.model.provider = preset.model.provider;
  agentForm.model.modelId = preset.model.modelId;
  showCustomModel.value = savedModels.value.every(
    (model) => !(model.provider === preset.model.provider && model.modelId === preset.model.modelId),
  );
}

function handlePresetSelection(presetId: string) {
  selectedPresetId.value = presetId;
  if (!presetId) {
    return;
  }
  const preset = agentStore.sortedPresets.find((item) => item.id === presetId);
  if (!preset) {
    return;
  }
  applyPresetToForm(preset);
}

function clearModelSelection() {
  agentForm.model.provider = "";
  agentForm.model.modelId = "";
  showCustomModel.value = true;
}

function addAgent() {
  if (!agentForm.id || !agentForm.name) return;
  if (agents.some((agent) => agent.id === agentForm.id)) return;
  agents.push({ ...agentForm, model: { ...agentForm.model } });
  syncOrchestrator();
  agentForm.id = "";
  agentForm.name = "";
  agentForm.description = "";
  agentForm.systemPrompt = "";
  agentForm.model = { provider: "", modelId: "" };
  showAgentForm.value = false;
  showCustomModel.value = false;
  selectedPresetId.value = "";
}

function removeAgent(index: number) {
  agents.splice(index, 1);
  syncOrchestrator();
}

function reorderAgents(fromIndex: number, toIndex: number): boolean {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= agents.length
    || toIndex >= agents.length
  ) {
    return false;
  }
  const [moved] = agents.splice(fromIndex, 1);
  if (!moved) {
    return false;
  }
  agents.splice(toIndex, 0, moved);
  return true;
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
    syncOrchestrator(orchestratorId.value);
  }
  draggingAgentIndex.value = null;
  dragOverAgentIndex.value = null;
}

function handleAgentDragEnd() {
  draggingAgentIndex.value = null;
  dragOverAgentIndex.value = null;
}

function submit() {
  if (!name.value || !agents.length) return;
  const swarmId = name.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const orchestrator = mode.value === "router"
    ? agents.find((agent) => agent.id === orchestratorId.value) ?? agents[0]
    : undefined;
  const swarm: SwarmConfig = {
    id: swarmId,
    name: name.value,
    mode: mode.value,
    agents: agents.map((agent) => ({ ...agent, model: { ...agent.model } })),
  };
  if (orchestrator) {
    swarm.orchestrator = { ...orchestrator, model: { ...orchestrator.model } };
  }
  if (mode.value === "debate") {
    swarm.debateConfig = {
      rounds: 3,
      proAgent: agents[0]?.id ?? "",
      conAgent: agents[1]?.id ?? agents[0]?.id ?? "",
      judgeAgent: agents[0]?.id ?? "",
    };
  }
  if (mode.value === "parallel") {
    if (aggregatorType.value === "none") {
      swarm.aggregator = { type: "none" };
    } else if (aggregatorType.value === "merge") {
      swarm.aggregator = { type: "merge" };
    } else if (aggregatorType.value === "vote") {
      swarm.aggregator = { type: "vote", quorum: aggregatorQuorum.value };
    } else if (aggregatorType.value === "best") {
      const judgeAgent = aggregatorJudgeAgent.value || agents[0]?.id || "";
      swarm.aggregator = { type: "best", judgeAgent };
    }
  }
  emit("create", swarm);
}

onMounted(() => {
  if (!settingsStore.config) {
    void settingsStore.fetchConfig();
  }
  if (!agentStore.loaded) {
    void agentStore.fetchAgents();
  }
});
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <div>
          <h3>创建 Swarm</h3>
          <p class="dialog-subtitle">配置多 Agent 协作集群</p>
        </div>
        <button class="close-btn" @click="emit('close')">
          <SvgIcon name="close" :size="16" />
        </button>
      </div>

      <div class="dialog-body">
        <div class="form-section">
          <label class="form-label">名称</label>
          <input v-model="name" class="input-field" placeholder="My Swarm" />
        </div>

        <div class="form-section">
          <label class="form-label">协作模式</label>
          <div class="mode-grid">
            <div
              v-for="m in modes"
              :key="m.value"
              class="mode-option"
              :class="{ active: mode === m.value }"
              @click="setMode(m.value)"
            >
              <span class="mode-icon"><ModeIcon :mode="m.value" /></span>
              <div class="mode-info">
                <span class="mode-name">{{ m.label }}</span>
                <span class="mode-desc">{{ m.desc }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="mode === 'router'" class="form-section">
          <label class="form-label">Orchestrator</label>
          <div class="form-row" style="margin-bottom: 0;">
            <CustomSelect
              :model-value="orchestratorId"
              :options="orchestratorOptions"
              placeholder="选择路由 Agent"
              @update:model-value="orchestratorId = $event"
            />
          </div>
          <p class="orchestrator-hint">Router 模式会由该 Agent 负责路由决策。</p>
        </div>

        <div class="form-section">
          <div class="section-header">
            <label class="form-label">Agents ({{ agents.length }})</label>
            <button class="btn-secondary" style="padding: 6px 12px; font-size: var(--text-base);" @click="showAgentForm = !showAgentForm">
              <SvgIcon v-if="!showAgentForm" name="plus" :size="14" />
              <SvgIcon v-else name="close" :size="14" />
              {{ showAgentForm ? '取消' : '添加 Agent' }}
            </button>
          </div>

          <!-- Agent Form Dialog -->
          <div v-if="showAgentForm" class="sub-dialog-overlay" @click.self="showAgentForm = false">
            <div class="sub-dialog">
              <div class="sub-dialog-header">
                <h4>添加 Agent</h4>
                <button class="close-btn" @click="showAgentForm = false">
                  <SvgIcon name="close" :size="16" />
                </button>
              </div>
              <div class="sub-dialog-body">
                <div v-if="agentStore.sortedPresets.length > 0" class="form-row">
                  <label>预设模板</label>
                  <CustomSelect
                    :model-value="selectedPresetId"
                    :options="presetAgentOptions"
                    placeholder="选择 Agent 预设模板"
                    @update:model-value="handlePresetSelection"
                  />
                </div>
                <div class="form-row">
                  <label>ID</label>
                  <input v-model="agentForm.id" class="input-field" placeholder="agent-1" />
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
                      <SvgIcon name="edit" :size="12" />
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
              <div class="sub-dialog-footer">
                <button class="btn-secondary" @click="showAgentForm = false">取消</button>
                <button class="btn-primary" :disabled="!agentForm.id || !agentForm.name" @click="addAgent">确认添加</button>
              </div>
            </div>
          </div>

          <div v-if="agents.length" class="agent-list">
            <div
              v-for="(agent, i) in agents"
              :key="agent.id"
              class="agent-list-item"
              :class="{
                dragging: draggingAgentIndex === i,
                'drag-over': dragOverAgentIndex === i && draggingAgentIndex !== i,
              }"
              draggable="true"
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
              <button class="remove-btn" @click="removeAgent(i)">
                <SvgIcon name="close" :size="14" />
              </button>
            </div>
          </div>
        </div>

        <!-- Parallel Aggregator Config -->
        <div v-if="mode === 'parallel'" class="form-section">
          <label class="form-label">聚合策略</label>
          <div class="form-row" style="margin-bottom: 8px;">
            <CustomSelect
              :model-value="aggregatorType"
              :options="[
                { value: 'none', label: '无聚合' },
                { value: 'merge', label: '合并结果' },
                { value: 'vote', label: '投票' },
                { value: 'best', label: '最佳选择' },
              ]"
              @update:model-value="aggregatorType = $event as AggregationStrategy['type']"
            />
          </div>
          <div v-if="aggregatorType === 'vote'" class="form-row" style="margin-bottom: 0;">
            <label>法定人数</label>
            <input
              type="number"
              v-model.number="aggregatorQuorum"
              class="input-field"
              min="1"
              :max="agents.length"
              style="width: 100px;"
            />
          </div>
          <div v-if="aggregatorType === 'best'" class="form-row" style="margin-bottom: 0;">
            <label>裁判 Agent</label>
            <CustomSelect
              :model-value="aggregatorJudgeAgent"
              :options="[{ value: '', label: '选择裁判 Agent' }, ...agents.map(a => ({ value: a.id, label: `${a.name} (${a.id})` }))]"
              @update:model-value="aggregatorJudgeAgent = $event"
            />
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('close')">取消</button>
        <button class="btn-primary" :disabled="!name || !agents.length" @click="submit">
          创建
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 600px;
  max-width: calc(100vw - 48px);
  max-height: 85vh;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 24px 0;
  flex-shrink: 0;
}

.dialog-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
}

.dialog-subtitle {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.close-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}



.sub-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sub-dialog {
  width: 440px;
  max-height: 80vh;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.sub-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px 0;
}

.sub-dialog-header h4 {
  color: var(--text-primary);
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}

.sub-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}

.sub-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 20px;
  border-top: 1px solid var(--border-subtle);
}

.form-section {
  margin-bottom: 20px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-header .form-label {
  margin-bottom: 0;
}

.mode-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  font-family: inherit;
  color: var(--text-secondary);
}

.mode-option:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.mode-option.active {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}

.orchestrator-hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.model-selection {
  margin-bottom: 12px;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-chip {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.model-chip:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.model-chip.active {
  background: var(--bg-hover);
  border-color: var(--border-default);
  color: var(--text-secondary);
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: grab;
  transition: all 0.2s;
}

.agent-list-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.agent-list-item.dragging {
  opacity: 0.58;
  border-color: var(--border-default);
  background: var(--bg-hover);
  cursor: grabbing;
}

.agent-list-item.drag-over {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-avatar {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-primary);
}

.agent-name {
  display: block;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
}

.agent-desc {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.agent-model {
  display: block;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  margin-top: 2px;
}

.remove-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.remove-btn:hover {
  background: var(--bg-danger);
  color: var(--color-danger);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--border-subtle);
}
</style>
