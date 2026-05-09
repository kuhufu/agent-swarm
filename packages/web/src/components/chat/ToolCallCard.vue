<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallInfo } from "../../types/index.js";
import SvgIcon from "../common/SvgIcon.vue";
import SectionLabel from "./SectionLabel.vue";
import JavascriptExecutionCard, { extractJavascriptExecution } from "./JavascriptExecutionCard.vue";
import KnowledgeReferencesCard, { extractKnowledgeReferences, extractQueryText } from "./KnowledgeReferencesCard.vue";
import WikiReferencesCard, { extractWikiReferences } from "./WikiReferencesCard.vue";
import WebSearchCard from "./WebSearchCard.vue";
import WebFetchCard from "./WebFetchCard.vue";
import WorkspaceReadFileCard from "./WorkspaceReadFileCard.vue";
import WorkspaceListFilesCard from "./WorkspaceListFilesCard.vue";
import WorkspaceGrepCard from "./WorkspaceGrepCard.vue";
import ContainerResultCard from "./ContainerResultCard.vue";
import NextActionsCard from "./NextActionsCard.vue";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const expanded = ref(false);
const showRaw = ref(false);

const isKnowledgeTool = computed(() => props.toolCall.name === "retrieve_knowledge");
const isWikiTool = computed(() => props.toolCall.name === "search_wiki");
const isJavascriptTool = computed(() => props.toolCall.name === "javascript_execute");
const isWebSearchTool = computed(() => props.toolCall.name === "web_search");
const isWebFetchTool = computed(() => props.toolCall.name === "web_fetch");
const isReadFileTool = computed(() => props.toolCall.name === "workspace_read_file");
const isListFilesTool = computed(() => props.toolCall.name === "workspace_list_files");
const isGrepTool = computed(() => props.toolCall.name === "workspace_grep");
const isContainerTool = computed(() => props.toolCall.name.startsWith("workspace_") && !["workspace_read_file", "workspace_list_files", "workspace_grep", "workspace_write_file"].includes(props.toolCall.name));

const workspaceArtifact = computed(() => extractWorkspaceArtifact(props.toolCall.details, props.toolCall.name));

const knowledgeReferences = computed(() => isKnowledgeTool.value
  ? extractKnowledgeReferences(props.toolCall.details)
  : null);
const hasKnowledgeResult = computed(() => isKnowledgeTool.value && props.toolCall.details !== undefined);
const wikiReferences = computed(() => isWikiTool.value
  ? extractWikiReferences(props.toolCall.details)
  : null);
const hasWikiResult = computed(() => isWikiTool.value && props.toolCall.details !== undefined);
const javascriptExecution = computed(() => isJavascriptTool.value
  ? extractJavascriptExecution(props.toolCall.details, props.toolCall.arguments)
  : null);
const hasJavascriptResult = computed(() => isJavascriptTool.value && javascriptExecution.value !== null);

const webSearchResults = computed(() => {
  if (!isWebSearchTool.value || !Array.isArray(props.toolCall.details)) return null;
  return props.toolCall.details as Array<{ title: string; url: string; snippet: string }>;
});
const hasWebSearchResults = computed(() => webSearchResults.value !== null && webSearchResults.value.length > 0);

const webFetchResult = computed(() => {
  if (!isWebFetchTool.value || !props.toolCall.details || typeof props.toolCall.details !== "object") return null;
  return props.toolCall.details as { url: string; title: string; content: string; description?: string; contentType: string };
});
const hasWebFetchResult = computed(() => webFetchResult.value !== null);

const readFileDetails = computed(() => {
  if (!isReadFileTool.value || !props.toolCall.details || typeof props.toolCall.details !== "object") return null;
  const raw = props.toolCall.details as Record<string, unknown>;
  if (typeof raw.path !== "string") return null;
  return raw as { path: string; size: number; truncated: boolean; meta: { kind: string; language?: string; previewable: boolean } };
});
const hasReadFileResult = computed(() => readFileDetails.value !== null);

const listFilesDetails = computed(() => {
  if (!isListFilesTool.value || !props.toolCall.details || typeof props.toolCall.details !== "object") return null;
  const raw = props.toolCall.details as Record<string, unknown>;
  if (!Array.isArray(raw.files)) return null;
  return raw as { files: Array<{ path: string; size: number; type: "file" | "dir"; updatedAt?: number }>; count: number; totalSize: number; directories: string[] };
});
const hasListFilesResult = computed(() => listFilesDetails.value !== null);

const grepDetails = computed(() => {
  if (!isGrepTool.value || !props.toolCall.details || typeof props.toolCall.details !== "object") return null;
  const raw = props.toolCall.details as Record<string, unknown>;
  if (!Array.isArray(raw.matches)) return null;
  return raw as { matches: Array<{ path: string; line: number; content: string }>; total: number; matchedPaths: string[] };
});
const hasGrepResult = computed(() => grepDetails.value !== null);

const queryText = computed(() => extractQueryText(props.toolCall.arguments));
const formattedArguments = computed(() => {
  if (props.toolCall.arguments !== undefined) {
    return JSON.stringify(props.toolCall.arguments, null, 2);
  }
  return props.toolCall.argumentsText ?? "";
});

const nextActions = computed(() => {
  if (!props.toolCall.details || typeof props.toolCall.details !== "object") return null;
  const raw = props.toolCall.details as Record<string, unknown>;
  const na = raw.nextActions;
  if (Array.isArray(na) && na.length > 0) {
    return na as Array<{ tool: string; reason: string; params?: Record<string, unknown> }>;
  }
  return null;
});

const formattedContent = computed(() => {
  if (!props.toolCall.content) return "";
  return props.toolCall.content.map((c: any) => c.text ?? "").join("\n");
});

const paramSummary = computed(() => {
  const args = props.toolCall.arguments;
  if (!args || typeof args !== "object") return null;
  const raw = args as Record<string, unknown>;
  if (typeof raw.query === "string" && raw.query) return raw.query;
  if (typeof raw.pattern === "string" && raw.pattern) return raw.pattern;
  if (typeof raw.path === "string" && raw.path) return raw.path;
  if (typeof raw.code === "string") {
    const lines = raw.code.split("\n").filter((l: string) => l.trim().length > 0);
    return lines.length === 1 ? raw.code : `${lines[0]} …`;
  }
  return null;
});

const formattedDuration = computed(() => {
  const ms = props.toolCall.durationMs;
  if (ms === undefined || ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
});

const status = computed(() => {
  if (props.toolCall.isError === true) {
    return { label: "失败", cls: "error" };
  }
  if (props.toolCall.details !== undefined) {
    return { label: "完成", cls: "success" };
  }
  return { label: "运行中", cls: "running" };
});

function extractWorkspaceArtifact(details: unknown, toolName: string): { path: string; size?: number; kind?: string } | null {
  if (toolName !== "workspace_write_file" || !details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const raw = details as Record<string, unknown>;
  const path = typeof raw.path === "string" ? raw.path : "";
  if (!path) return null;
  return {
    path,
    size: typeof raw.size === "number" ? raw.size : undefined,
    kind: typeof raw.kind === "string" ? raw.kind : undefined,
  };
}

function openArtifact(path: string) {
  window.dispatchEvent(new CustomEvent("agent-swarm:open-artifact", { detail: { path } }));
}

function handleApplyNextAction(action: { tool: string; reason: string; params?: Record<string, unknown> }) {
  const text = `${action.tool}${action.params ? " " + JSON.stringify(action.params) : ""}`;
  window.dispatchEvent(new CustomEvent("agent-swarm:fill-input", { detail: { text } }));
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
</script>

<template>
  <div class="tool-call-card" :class="{ expanded }" @click="expanded = !expanded">
    <div class="tool-header">
      <div class="tool-icon-wrapper">
        <SvgIcon name="wrench" :size="12" />
      </div>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span v-if="paramSummary" class="tool-param-summary" :title="paramSummary">{{ paramSummary }}</span>
      <span v-if="formattedDuration" class="tool-duration">{{ formattedDuration }}</span>
      <span :class="['tool-status', status.cls]">
        {{ status.label }}
      </span>
      <SvgIcon class="expand-icon" :class="{ rotated: expanded }" name="chevronDown" :size="14" />
    </div>
    <div v-if="expanded" class="tool-details">
      <div class="tool-section">
        <SectionLabel icon="jsExecute" label="参数" />
        <pre>{{ formattedArguments }}</pre>
      </div>
      <KnowledgeReferencesCard
        v-if="hasKnowledgeResult"
        :references="knowledgeReferences ?? []"
        :query-text="queryText"
      />
      <WikiReferencesCard
        v-else-if="hasWikiResult"
        :references="wikiReferences ?? []"
      />
      <JavascriptExecutionCard
        v-else-if="hasJavascriptResult && javascriptExecution"
        :execution="javascriptExecution"
        :is-error="toolCall.isError === true"
      />
      <div v-else-if="workspaceArtifact" class="tool-section">
        <SectionLabel icon="folder" label="产物" />
        <div class="artifact-result">
          <div>
            <strong>{{ workspaceArtifact.path }}</strong>
            <span>{{ workspaceArtifact.kind ?? "file" }} {{ formatSize(workspaceArtifact.size) }}</span>
          </div>
          <button class="artifact-open-btn" type="button" title="查看产物" @click.stop="openArtifact(workspaceArtifact.path)">
            <SvgIcon name="arrowRight" :size="13" />
            查看
          </button>
        </div>
      </div>
      <WebSearchCard
        v-else-if="hasWebSearchResults"
        :results="webSearchResults!"
      />
      <WebFetchCard
        v-else-if="hasWebFetchResult"
        :result="webFetchResult!"
      />
      <WorkspaceReadFileCard
        v-else-if="hasReadFileResult"
        :details="readFileDetails!"
      />
      <WorkspaceListFilesCard
        v-else-if="hasListFilesResult"
        :details="listFilesDetails!"
      />
      <WorkspaceGrepCard
        v-else-if="hasGrepResult"
        :details="grepDetails!"
      />
      <ContainerResultCard
        v-else-if="isContainerTool"
        :tool-name="toolCall.name"
        :details="(toolCall.details as Record<string, unknown>) ?? {}"
      />
      <div v-else-if="toolCall.details" class="tool-section">
        <SectionLabel icon="check" label="结果" />
        <pre>{{ JSON.stringify(toolCall.details, null, 2) }}</pre>
      </div>

      <NextActionsCard v-if="nextActions" :actions="nextActions" @apply="handleApplyNextAction" />

      <div v-if="formattedContent" class="tool-section">
        <SectionLabel icon="message" label="返回给模型的内容" />
        <pre>{{ formattedContent }}</pre>
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
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.tool-call-card:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: var(--color-border-hover);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.tool-call-card.expanded {
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 0 0 1px rgba(99,102,241,0.08);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.tool-icon-wrapper {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(99, 102, 241, 0.1);
  border-radius: 6px;
  color: var(--color-accent-light);
}

.tool-icon-wrapper svg {
  width: 12px;
  height: 12px;
}

.tool-name {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-family: var(--font-mono);
  font-weight: 500;
  flex-shrink: 0;
}

.tool-param-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
}

.tool-duration {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.tool-status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-weight: 600;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.12);
  color: var(--color-success);
}

.tool-status.error {
  background: rgba(239, 68, 68, 0.12);
  color: var(--color-danger);
}

.tool-status.running {
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-warning);
}

.expand-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.tool-details {
  padding: 0 14px 14px;
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 0;
}

.tool-section {
  margin-top: 12px;
}

pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  line-height: 1.6;
  border: 1px solid var(--color-border-subtle);
}

.artifact-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.artifact-result div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.artifact-result strong {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.artifact-result span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.artifact-open-btn {
  height: 28px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s ease;
}

.artifact-open-btn:hover {
  color: var(--color-accent-light);
  border-color: rgba(99, 102, 241, 0.32);
  background: rgba(99, 102, 241, 0.12);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.06);
}

.artifact-open-btn svg {
  transition: transform 0.15s ease;
}

.artifact-open-btn:hover svg {
  transform: translateX(1px);
}

.raw-toggle-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}
.raw-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.16s;
}
.raw-toggle-btn:hover {
  color: var(--color-text-secondary);
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
  color: var(--color-text-secondary);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}

</style>
