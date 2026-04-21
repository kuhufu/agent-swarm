<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { useSettingsStore } from "../../stores/settings.js";
import type { SwarmConfig, SwarmAgentConfig, CollaborationMode, SavedModel } from "../../types/index.js";

const emit = defineEmits<{
  (e: "create", swarm: SwarmConfig): void;
  (e: "close"): void;
}>();

const modes: { value: CollaborationMode; label: string; desc: string; icon: string }[] = [
  { value: "router", label: "Router 路由", desc: "智能路由到最合适的 Agent", icon: "🔀" },
  { value: "sequential", label: "Sequential 顺序", desc: "按顺序依次执行", icon: "➡️" },
  { value: "parallel", label: "Parallel 并行", desc: "多个 Agent 同时执行", icon: "⏩" },
  { value: "swarm", label: "Swarm 蜂群", desc: "去中心化协作", icon: "🐝" },
  { value: "debate", label: "Debate 辩论", desc: "多 Agent 辩论模式", icon: "⚖️" },
];

const name = ref("");
const mode = ref<CollaborationMode>("router");
const agents = reactive<SwarmAgentConfig[]>([]);

const showAgentForm = ref(false);
const agentForm = reactive<SwarmAgentConfig>({
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  model: { provider: "", modelId: "" },
});
const showCustomModel = ref(false);

const settingsStore = useSettingsStore();
const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);

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

function addAgent() {
  if (!agentForm.id || !agentForm.name) return;
  agents.push({ ...agentForm, model: { ...agentForm.model } });
  agentForm.id = "";
  agentForm.name = "";
  agentForm.description = "";
  agentForm.systemPrompt = "";
  agentForm.model = { provider: "", modelId: "" };
  showAgentForm.value = false;
  showCustomModel.value = false;
}

function removeAgent(index: number) {
  agents.splice(index, 1);
}

function submit() {
  if (!name.value || !agents.length) return;
  const swarmId = name.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const orchestrator = mode.value === "router"
    ? agents[0]
    : undefined;
  const swarm: SwarmConfig = {
    id: swarmId,
    name: name.value,
    mode: mode.value,
    agents: [...agents],
  };
  if (orchestrator) {
    swarm.orchestrator = { ...orchestrator };
  }
  if (mode.value === "debate") {
    swarm.debateConfig = {
      rounds: 3,
      proAgent: agents[0]?.id ?? "",
      conAgent: agents[1]?.id ?? agents[0]?.id ?? "",
      judgeAgent: agents[0]?.id ?? "",
    };
  }
  emit("create", swarm);
}
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
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
              @click="mode = m.value"
            >
              <span class="mode-icon">{{ m.icon }}</span>
              <div class="mode-info">
                <span class="mode-name">{{ m.label }}</span>
                <span class="mode-desc">{{ m.desc }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="section-header">
            <label class="form-label">Agents ({{ agents.length }})</label>
            <button class="btn-secondary" style="padding: 6px 12px; font-size: 13px;" @click="showAgentForm = !showAgentForm">
              <svg v-if="!showAgentForm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {{ showAgentForm ? '取消' : '添加 Agent' }}
            </button>
          </div>

          <div v-if="showAgentForm" class="agent-form card">
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

            <!-- Model Selection -->
            <div v-if="savedModels.length > 0" class="model-selection">
              <label class="form-label" style="margin-bottom: 8px;">选择模型</label>
              <div class="model-chips">
                <button
                  v-for="sm in savedModels"
                  :key="sm.id"
                  class="model-chip"
                  :class="{ active: agentForm.model.provider === sm.provider && agentForm.model.modelId === sm.modelId }"
                  @click="selectModelForAgent(sm)"
                >
                  {{ sm.name }}
                </button>
                <button
                  class="model-chip"
                  :class="{ active: showCustomModel }"
                  @click="clearModelSelection"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
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
            <button class="btn-primary" style="margin-top: 8px;" :disabled="!agentForm.id || !agentForm.name" @click="addAgent">
              确认添加
            </button>
          </div>

          <div v-if="agents.length" class="agent-list">
            <div v-for="(agent, i) in agents" :key="agent.id" class="agent-list-item">
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
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
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.dialog {
  width: 560px;
  max-height: 85vh;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-default);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 24px 24px 0;
}

.dialog-header h3 {
  color: var(--color-text-primary);
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.dialog-subtitle {
  color: var(--color-text-muted);
  font-size: 14px;
  margin: 4px 0 0;
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

.dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.form-section {
  margin-bottom: 20px;
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

.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
  font-size: 20px;
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

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.agent-form {
  padding: 16px;
  margin-bottom: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
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
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.model-chip:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.model-chip.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  transition: all 0.2s;
}

.agent-list-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-hover);
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
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent-light);
}

.agent-name {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.agent-desc {
  display: block;
  color: var(--color-text-muted);
  font-size: 11px;
}

.agent-model {
  display: block;
  color: var(--color-accent-light);
  font-size: 11px;
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
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s;
}

.remove-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--color-border-subtle);
}
</style>
