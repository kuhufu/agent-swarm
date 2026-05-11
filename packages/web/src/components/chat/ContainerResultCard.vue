<script setup lang="ts">
import { computed } from "vue";
import SectionLabel from "./SectionLabel.vue";

const props = defineProps<{
  toolName: string;
  details: Record<string, unknown>;
}>();

const isRun = computed(() => props.toolName === "workspace_run_container");
const isList = computed(() => props.toolName === "workspace_list_containers");
const isPull = computed(() => props.toolName === "workspace_pull_image");
const isRemove = computed(() => props.toolName === "workspace_remove_containers");
const isSimpleOp = computed(() =>
  ["workspace_start_containers", "workspace_stop_containers", "workspace_restart_containers"].includes(props.toolName),
);

const containers = computed(() => {
  const raw = props.details.containers;
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  return [];
});
const stdout = computed(() => typeof props.details.stdout === "string" ? props.details.stdout : "");
const stderr = computed(() => typeof props.details.stderr === "string" ? props.details.stderr : "");
const exitCode = computed(() => {
  const ec = props.details.exitCode;
  return typeof ec === "number" ? ec : null;
});

function opLabel(name: string): string {
  const map: Record<string, string> = {
    workspace_start_containers: "启动容器",
    workspace_stop_containers: "停止容器",
    workspace_restart_containers: "重启容器",
    workspace_remove_containers: "移除容器",
    workspace_run_container: "运行容器",
    workspace_list_containers: "容器列表",
    workspace_pull_image: "拉取镜像",
  };
  return map[name] ?? name;
}
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="monitor" :label="opLabel(toolName)" />

    <!-- list containers -->
    <div v-if="isList && containers.length > 0" class="container-table">
      <div class="ct-header">
        <span>ID</span>
        <span>名称</span>
        <span>镜像</span>
        <span>状态</span>
        <span>端口</span>
      </div>
      <div v-for="(c, i) in containers" :key="i" class="ct-row">
        <span class="ct-id">{{ c.id }}</span>
        <span>{{ c.name }}</span>
        <span>{{ c.image }}</span>
        <span :class="['ct-status', c.status === 'running' ? 'running' : '']">{{ c.status }}</span>
        <span class="ct-ports">{{ c.ports }}</span>
      </div>
    </div>

    <!-- run container output -->
    <div v-else-if="isRun" class="run-output">
      <div v-if="exitCode !== null" class="run-meta">
        <span class="run-label">退出码</span>
        <span :class="['run-exit-code', exitCode === 0 ? 'success' : 'error']">{{ exitCode }}</span>
        <span v-if="details.timedOut" class="run-badge timedout">超时</span>
        <span v-if="details.aborted" class="run-badge aborted">已中断</span>
        <span v-if="details.background" class="run-badge bg">后台运行</span>
      </div>
      <div v-if="stdout" class="run-block">
        <div class="run-block-title">标准输出</div>
        <pre class="run-pre">{{ stdout }}</pre>
      </div>
      <div v-if="stderr" class="run-block">
        <div class="run-block-title">错误输出</div>
        <pre class="run-pre run-pre-error">{{ stderr }}</pre>
      </div>
    </div>

    <!-- pull image -->
    <div v-else-if="isPull" class="pull-card">
      <div class="pull-field">
        <span class="pull-label">镜像</span>
        <span class="pull-value">{{ details.image }}</span>
      </div>
      <div class="pull-field">
        <span class="pull-label">状态</span>
        <span :class="['pull-status', details.success ? 'success' : 'error']">
          {{ details.success ? "成功" : "失败" }}
        </span>
      </div>
      <div v-if="details.message" class="pull-field">
        <span class="pull-label">消息</span>
        <span class="pull-value">{{ details.message }}</span>
      </div>
    </div>

    <!-- simple ops: start/stop/restart/remove -->
    <div v-else-if="isSimpleOp || isRemove" class="simple-op-card">
      <div class="op-field">
        <span class="op-label">{{ isRemove ? "已移除" : "已操作" }}</span>
        <span class="op-count">{{ details.succeeded ?? details.containersRemoved }}</span>
      </div>
      <div v-if="details.containerNames" class="op-field">
        <span class="op-label">容器</span>
        <span class="op-value">{{ (details.containerNames as string[])?.join(", ") }}</span>
      </div>
    </div>

    <div v-else class="fallback-card">
      <pre class="fallback-pre">{{ JSON.stringify(details, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
/* list containers table */
.container-table {
  display: grid;
  gap: 1px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
}
.ct-header, .ct-row {
  display: grid;
  grid-template-columns: 64px 1fr 1fr 72px 80px;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
}
.ct-header {
  background: rgba(255,255,255,0.04);
  color: var(--text-muted);
  font-weight: var(--weight-bold);
}
.ct-row {
  background: rgba(255,255,255,0.02);
}
.ct-row:hover {
  background: rgba(255,255,255,0.04);
}
.ct-id {
  font-family: var(--font-mono);
  color: var(--text-muted);
}
.ct-status.running {
  color: var(--color-success);
}
.ct-ports {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* run container output */
.run-output {
  display: grid;
  gap: 8px;
}
.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.run-label {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
}
.run-exit-code {
  font-family: var(--font-mono);
  font-size: var(--text-base);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
}
.run-exit-code.success {
  color: var(--color-success);
  background: rgba(34,197,94,0.1);
}
.run-exit-code.error {
  color: var(--color-danger);
  background: rgba(239,68,68,0.1);
}
.run-badge {
  padding: 2px 7px;
  border-radius: 9999px;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}
.run-badge.timedout {
  background: rgba(245,158,11,0.1);
  color: var(--color-warning);
}
.run-badge.aborted {
  background: rgba(239,68,68,0.1);
  color: var(--color-danger);
}
.run-badge.bg {
  background: rgba(99,102,241,0.1);
  color: var(--text-secondary);
}
.run-block {
  display: grid;
  gap: 4px;
}
.run-block-title {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
.run-pre {
  margin: 0;
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--text-secondary);
  background: rgba(0,0,0,0.24);
  border: 1px solid rgba(255,255,255,0.06);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 300px;
  overflow-y: auto;
}
.run-pre-error {
  color: var(--color-danger);
  border-color: rgba(239,68,68,0.15);
}

/* pull image */
.pull-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-subtle);
  display: grid;
  gap: 8px;
}
.pull-field {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pull-label {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  min-width: 36px;
}
.pull-value {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.pull-status {
  padding: 1px 7px;
  border-radius: 9999px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
.pull-status.success {
  color: var(--color-success);
  background: rgba(34,197,94,0.1);
}
.pull-status.error {
  color: var(--color-danger);
  background: rgba(239,68,68,0.1);
}

/* simple ops */
.simple-op-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-subtle);
  display: grid;
  gap: 8px;
}
.op-field {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.op-label {
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
.op-count {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.op-value {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

/* fallback */
.fallback-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-subtle);
}
.fallback-pre {
  margin: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
}
</style>
