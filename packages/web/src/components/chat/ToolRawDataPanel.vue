<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";
import SectionLabel from "./SectionLabel.vue";
import { formatToolArguments, formatToolContent } from "./tool-card-utils.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const showRaw = ref(false);
const showContent = ref(false);

const formattedArguments = computed(() => formatToolArguments(props.toolCall));
const formattedContent = computed(() => formatToolContent(props.toolCall));
</script>

<template>
  <div v-if="formattedContent" class="tool-section content-toggle-section">
    <button class="content-toggle-btn" type="button" @click.stop="showContent = !showContent">
      <SvgIcon :name="showContent ? 'chevronDown' : 'chevronRight'" :size="12" />
      返回给模型的内容
    </button>
    <pre v-if="showContent" class="content-pre" @click.stop>{{ formattedContent }}</pre>
  </div>

  <div class="tool-section raw-toggle-section">
    <button class="raw-toggle-btn" type="button" @click.stop="showRaw = !showRaw">
      <SvgIcon :name="showRaw ? 'chevronDown' : 'chevronRight'" :size="12" />
      查看原始数据
    </button>
    <div v-if="showRaw" class="raw-panel" @click.stop>
      <div class="raw-block">
        <SectionLabel icon="jsExecute" label="参数 (arguments)" />
        <pre class="raw-pre">{{ formattedArguments }}</pre>
      </div>
      <div v-if="toolCall.content" class="raw-block">
        <SectionLabel icon="message" label="返回内容 (content)" />
        <pre class="raw-pre">{{ JSON.stringify(toolCall.content, null, 2) }}</pre>
      </div>
      <div class="raw-block">
        <SectionLabel icon="check" label="结构化数据 (details)" />
        <pre class="raw-pre">{{ JSON.stringify(toolCall.details, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-toggle-section {
  margin-top: 6px;
}

.content-toggle-btn,
.raw-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.16s;
}

.content-toggle-btn:hover,
.raw-toggle-btn:hover {
  color: var(--text-secondary);
}

.content-pre {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}

.raw-toggle-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.raw-panel {
  margin-top: 10px;
  display: grid;
  gap: 12px;
}

.raw-block {
  display: grid;
  gap: 4px;
}

.raw-pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}
</style>
