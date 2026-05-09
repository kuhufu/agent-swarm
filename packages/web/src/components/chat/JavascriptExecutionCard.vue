<script lang="ts">
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringifyUnknown(item));
}

export function extractJavascriptExecution(details: unknown, args: unknown): JavascriptExecutionView | null {
  const raw = asRecord(details);
  if (!raw) return null;

  const argsRecord = asRecord(args);
  const code = typeof raw.code === "string"
    ? raw.code
    : (typeof argsRecord?.code === "string" ? argsRecord.code : "");
  const jsResult = stringifyUnknown(raw.result);
  const logs = normalizeStringArray(raw.logs);

  if (!code && jsResult.length === 0 && logs.length === 0) return null;

  return { code, result: jsResult.length > 0 ? jsResult : "undefined", logs };
}

export interface JavascriptExecutionView {
  code: string;
  result: string;
  logs: string[];
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import hljs from "highlight.js/lib/common";
import SectionLabel from "./SectionLabel.vue";

const props = defineProps<{
  execution: JavascriptExecutionView;
  isError: boolean;
}>();

const statusLabel = computed(() => props.isError ? "失败" : "成功");
const statusClass = computed(() => props.isError ? "error" : "success");
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="jsExecute" label="执行结果" />
    <div class="js-result-card" :class="{ error: isError }">
      <div class="js-result-grid">
        <div class="js-result-metric">
          <span class="js-metric-label">状态</span>
          <span :class="['js-status-pill', statusClass]">{{ statusLabel }}</span>
        </div>
        <div class="js-result-metric">
          <span class="js-metric-label">日志</span>
          <span class="js-metric-value">{{ execution.logs.length }} 条</span>
        </div>
      </div>

      <div class="js-output-block">
        <div class="js-block-title">返回值</div>
        <pre class="js-output-pre">{{ execution.result }}</pre>
      </div>

      <div class="js-output-block">
        <div class="js-block-title">日志</div>
        <div v-if="execution.logs.length > 0" class="js-log-list">
          <div
            v-for="(log, index) in execution.logs"
            :key="`${index}-${log}`"
            class="js-log-line"
          >
            <span class="js-log-index">{{ index + 1 }}</span>
            <span class="js-log-text">{{ log }}</span>
          </div>
        </div>
        <div v-else class="js-empty">无日志输出</div>
      </div>

      <details v-if="execution.code" class="js-code-details" @click.stop>
        <summary>查看代码</summary>
        <pre class="js-code-pre" v-html="hljs.highlight(execution.code, { language: 'javascript' }).value" />
      </details>
    </div>
  </div>
</template>

<style scoped>
.js-result-card {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
}

.js-result-card.error {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(239, 68, 68, 0.055);
}

.js-result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.js-result-metric {
  min-height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.js-metric-label,
.js-block-title {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.js-metric-value {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.js-status-pill {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
}

.js-status-pill.success {
  color: var(--color-success);
  background: rgba(34, 197, 94, 0.12);
}

.js-status-pill.error {
  color: var(--color-danger);
  background: rgba(239, 68, 68, 0.12);
}

.js-output-block {
  display: grid;
  gap: 6px;
}

.js-output-pre,
.js-code-pre {
  margin: 0;
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--color-text-primary);
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.js-log-list {
  display: grid;
  gap: 5px;
}

.js-log-line {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 7px 9px;
  border-radius: 7px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
}

.js-log-index {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.js-log-text {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.js-empty {
  padding: 9px 10px;
  border-radius: 7px;
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.14);
  border: 1px dashed var(--color-border-subtle);
  font-size: 12px;
}

.js-code-details {
  color: var(--color-text-secondary);
}

.js-code-details summary {
  width: fit-content;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.16s ease;
}

.js-code-details summary:hover {
  color: var(--color-text-primary);
}

.js-code-pre {
  margin-top: 8px;
}

@media (max-width: 640px) {
  .js-result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
