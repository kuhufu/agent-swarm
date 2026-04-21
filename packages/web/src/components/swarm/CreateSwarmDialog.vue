<script setup lang="ts">
import { ref, reactive } from "vue";
import type { SwarmConfig, SwarmAgentConfig, CollaborationMode } from "../../types/index.js";

const emit = defineEmits<{
  (e: "create", swarm: SwarmConfig): void;
  (e: "close"): void;
}>();

const modes: { value: CollaborationMode; label: string }[] = [
  { value: "router", label: "Router 路由" },
  { value: "sequential", label: "Sequential 顺序" },
  { value: "parallel", label: "Parallel 并行" },
  { value: "swarm", label: "Swarm 蜂群" },
  { value: "debate", label: "Debate 辩论" },
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

function addAgent() {
  if (!agentForm.id || !agentForm.name) return;
  agents.push({ ...agentForm, model: { ...agentForm.model } });
  agentForm.id = "";
  agentForm.name = "";
  agentForm.description = "";
  agentForm.systemPrompt = "";
  agentForm.model = { provider: "", modelId: "" };
  showAgentForm.value = false;
}

function removeAgent(index: number) {
  agents.splice(index, 1);
}

function submit() {
  if (!name.value || !agents.length) return;
  const swarmId = name.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  emit("create", {
    id: swarmId,
    name: name.value,
    mode: mode.value,
    agents: [...agents],
  });
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>创建 Swarm</h3>
        <t-button variant="text" size="small" @click="emit('close')">✕</t-button>
      </div>

      <div class="dialog-body">
        <div class="form-row">
          <label>名称</label>
          <t-input v-model="name" placeholder="My Swarm" />
        </div>

        <div class="form-row">
          <label>协作模式</label>
          <t-select v-model="mode">
            <t-option v-for="m in modes" :key="m.value" :value="m.value" :label="m.label" />
          </t-select>
        </div>

        <div class="agents-section">
          <div class="section-header">
            <label>Agents ({{ agents.length }})</label>
            <t-button size="small" @click="showAgentForm = !showAgentForm">
              {{ showAgentForm ? '取消' : '+ 添加 Agent' }}
            </t-button>
          </div>

          <!-- Agent form -->
          <div v-if="showAgentForm" class="agent-form">
            <div class="form-row">
              <label>ID</label>
              <t-input v-model="agentForm.id" placeholder="agent-1" />
            </div>
            <div class="form-row">
              <label>名称</label>
              <t-input v-model="agentForm.name" placeholder="Agent 1" />
            </div>
            <div class="form-row">
              <label>描述</label>
              <t-input v-model="agentForm.description" placeholder="负责..." />
            </div>
            <div class="form-row">
              <label>System Prompt</label>
              <t-textarea v-model="agentForm.systemPrompt" placeholder="你是一个..." :autosize="true" />
            </div>
            <div class="form-row">
              <label>Provider</label>
              <t-input v-model="agentForm.model.provider" placeholder="anthropic" />
            </div>
            <div class="form-row">
              <label>模型</label>
              <t-input v-model="agentForm.model.modelId" placeholder="claude-sonnet-4-20250514" />
            </div>
            <t-button size="small" theme="primary" @click="addAgent" :disabled="!agentForm.id || !agentForm.name">
              确认添加
            </t-button>
          </div>

          <!-- Agent list -->
          <div v-if="agents.length" class="agent-list">
            <div v-for="(agent, i) in agents" :key="agent.id" class="agent-item">
              <div class="agent-info">
                <span class="agent-name">{{ agent.name }}</span>
                <span class="agent-desc">{{ agent.description || agent.id }}</span>
              </div>
              <t-button variant="text" size="small" theme="danger" @click="removeAgent(i)">✕</t-button>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <t-button variant="outline" @click="emit('close')">取消</t-button>
        <t-button theme="primary" :disabled="!name || !agents.length" @click="submit">创建</t-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  width: 520px;
  max-height: 80vh;
  background: #1a1f35;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dialog-header h3 {
  color: #e0e0e0;
  margin: 0;
  font-size: 16px;
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.form-row label {
  color: #999;
  min-width: 80px;
  font-size: 13px;
  padding-top: 6px;
  flex-shrink: 0;
}

.form-row :deep(.t-input),
.form-row :deep(.t-select),
.form-row :deep(.t-textarea) {
  flex: 1;
}

.agents-section {
  margin-top: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-header label {
  color: #c0c0c0;
  font-size: 14px;
  font-weight: 500;
}

.agent-form {
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 12px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
}

.agent-info {
  display: flex;
  gap: 10px;
  align-items: center;
}

.agent-name {
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 500;
}

.agent-desc {
  color: #888;
  font-size: 12px;
}
</style>
