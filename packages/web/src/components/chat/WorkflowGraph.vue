<script setup lang="ts">
import { computed } from "vue";
import { agentColor } from "../../utils/agent-color.js";
import type { AgentState } from "../../types/index.js";
import {
  buildWorkflowGraph,
  getStatusColor,
  getStatusLabel,
} from "../../utils/workflow-graph.js";

const props = defineProps<{
  agents: AgentState[];
  mode?: string;
}>();

const graph = computed(() => buildWorkflowGraph(
  props.agents.map((a) => ({
    id: a.id,
    label: a.name,
    status: a.status,
    model: a.model ? `${a.model.provider}/${a.model.modelId}` : undefined,
    messages: 0,
  })),
  props.mode,
));

const hasEdges = computed(() => graph.value.edges.length > 0);
</script>

<template>
  <div class="workflow-graph" v-if="graph.nodes.length > 0">
    <div class="graph-title">工作流</div>
    <div class="graph-canvas" :class="`layout-${graph.layout}`">
      <template v-for="node in graph.nodes" :key="node.id">
        <div class="graph-node-wrapper">
          <div
            class="graph-node"
            :style="{ borderLeftColor: getStatusColor(node.status) }"
          >
            <div class="node-avatar" :style="{ background: agentColor(node.id) }">
              <span class="node-initial">{{ node.label[0]?.toUpperCase() }}</span>
            </div>
            <div class="node-info">
              <div class="node-name">{{ node.label }}</div>
              <div class="node-status" :style="{ color: getStatusColor(node.status) }">
                {{ getStatusLabel(node.status) }}
              </div>
            </div>
            <div v-if="node.model" class="node-model" :title="node.model">
              {{ node.model }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.workflow-graph {
  padding: 12px 12px 4px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.graph-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  padding: 0 4px;
}

.graph-canvas {
  display: flex;
  gap: 6px;
}

.graph-node-wrapper {
  flex: 1;
  min-width: 0;
}

.graph-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--glass-bg);
  border: 1px solid var(--color-border-subtle);
  border-left: 3px solid var(--color-text-muted);
  border-radius: 8px;
  transition: border-color 0.3s ease, background 0.2s ease;
  cursor: default;
}

.graph-node:hover {
  background: var(--glass-hover-bg);
}

.node-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.node-initial {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}

.node-info {
  min-width: 0;
  flex: 1;
}

.node-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-status {
  font-size: 10px;
  font-weight: 500;
  transition: color 0.3s ease;
}

.node-model {
  font-size: 9px;
  color: var(--color-text-muted);
  background: var(--input-bg);
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
  flex-shrink: 0;
}

/* Sequential: horizontal */
.layout-chain {
  flex-direction: row;
  overflow-x: auto;
  padding-bottom: 4px;
}

.layout-chain .graph-node-wrapper {
  flex: 0 0 auto;
  min-width: 130px;
}

.layout-chain .graph-node-wrapper + .graph-node-wrapper {
  position: relative;
  margin-left: 4px;
}

.layout-chain .graph-node-wrapper + .graph-node-wrapper::before {
  content: "→";
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  font-size: 14px;
}

/* Parallel / default: column */
.layout-grid {
  flex-direction: column;
}

.layout-grid .graph-node-wrapper {
  flex: none;
}
</style>
