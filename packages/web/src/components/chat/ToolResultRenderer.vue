<script setup lang="ts">
import { computed, markRaw, type Component } from "vue";
import type { ToolCallInfo } from "../../types/index.js";
import JavascriptExecutionCard, { extractJavascriptExecution } from "./JavascriptExecutionCard.vue";
import KnowledgeReferencesCard, { extractKnowledgeReferences, extractQueryText } from "./KnowledgeReferencesCard.vue";
import WikiReferencesCard, { extractWikiReferences } from "./WikiReferencesCard.vue";
import WebSearchCard from "./WebSearchCard.vue";
import WebFetchCard from "./WebFetchCard.vue";
import WorkspaceReadFileCard from "./WorkspaceReadFileCard.vue";
import WorkspaceListFilesCard from "./WorkspaceListFilesCard.vue";
import WorkspaceGrepCard from "./WorkspaceGrepCard.vue";
import WorkspaceArtifactCard from "./WorkspaceArtifactCard.vue";
import ContainerResultCard from "./ContainerResultCard.vue";
import ToolJsonResultCard from "./ToolJsonResultCard.vue";
import {
  extractWebFetchResult,
  extractWebSearchResults,
  extractWorkspaceArtifact,
  extractWorkspaceGrepDetails,
  extractWorkspaceListFilesDetails,
  extractWorkspaceReadFileDetails,
  isWorkspaceContainerTool,
} from "./tool-card-utils.js";

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

interface ToolResultView {
  component: Component;
  props: Record<string, unknown>;
  listeners?: Record<string, (...args: any[]) => void>;
}

interface ToolResultDefinition {
  id: string;
  component: Component;
  resolveProps: (toolCall: ToolCallInfo) => Record<string, unknown> | null;
  listeners?: Record<string, (...args: any[]) => void>;
}

function createResultView(definition: ToolResultDefinition, toolCall: ToolCallInfo): ToolResultView | null {
  const resultProps = definition.resolveProps(toolCall);
  if (!resultProps) return null;
  return {
    component: definition.component,
    props: resultProps,
    listeners: definition.listeners,
  };
}

function defineToolResult(
  id: string,
  component: Component,
  resolveProps: ToolResultDefinition["resolveProps"],
  listeners?: ToolResultDefinition["listeners"],
): ToolResultDefinition {
  return {
    id,
    component: markRaw(component),
    resolveProps,
    listeners,
  };
}

const TOOL_RESULT_DEFINITIONS: ToolResultDefinition[] = [
  defineToolResult("knowledge", KnowledgeReferencesCard, (toolCall) => {
    if (toolCall.name !== "retrieve_knowledge" || toolCall.details === undefined) return null;
    return {
      references: extractKnowledgeReferences(toolCall.details) ?? [],
      queryText: extractQueryText(toolCall.arguments),
    };
  }),
  defineToolResult("wiki", WikiReferencesCard, (toolCall) => {
    if (toolCall.name !== "search_wiki" || toolCall.details === undefined) return null;
    return { references: extractWikiReferences(toolCall.details) ?? [] };
  }),
  defineToolResult("javascript", JavascriptExecutionCard, (toolCall) => {
    if (toolCall.name !== "javascript_execute") return null;
    const execution = extractJavascriptExecution(toolCall.details, toolCall.arguments);
    if (!execution) return null;
    return { execution, isError: toolCall.isError === true };
  }),
  defineToolResult("workspace-artifact", WorkspaceArtifactCard, (toolCall) => {
    const artifact = extractWorkspaceArtifact(toolCall.details, toolCall.name);
    if (!artifact) return null;
    return { artifact };
  }, { open: openArtifact }),
  defineToolResult("web-search", WebSearchCard, (toolCall) => {
    const results = extractWebSearchResults(toolCall);
    if (!results || results.length === 0) return null;
    return { results };
  }),
  defineToolResult("web-fetch", WebFetchCard, (toolCall) => {
    const result = extractWebFetchResult(toolCall);
    if (!result) return null;
    return { result };
  }),
  defineToolResult("workspace-read-file", WorkspaceReadFileCard, (toolCall) => {
    const details = extractWorkspaceReadFileDetails(toolCall);
    if (!details) return null;
    return { details };
  }),
  defineToolResult("workspace-list-files", WorkspaceListFilesCard, (toolCall) => {
    const details = extractWorkspaceListFilesDetails(toolCall);
    if (!details) return null;
    return { details };
  }),
  defineToolResult("workspace-grep", WorkspaceGrepCard, (toolCall) => {
    const details = extractWorkspaceGrepDetails(toolCall);
    if (!details) return null;
    return { details };
  }),
  defineToolResult("workspace-container", ContainerResultCard, (toolCall) => {
    if (!isWorkspaceContainerTool(toolCall.name)) return null;
    return {
      toolName: toolCall.name,
      details: (toolCall.details as Record<string, unknown>) ?? {},
    };
  }),
  defineToolResult("json", ToolJsonResultCard, (toolCall) => {
    if (!toolCall.details) return null;
    return { details: toolCall.details };
  }),
];

const activeResult = computed(() => {
  for (const definition of TOOL_RESULT_DEFINITIONS) {
    const result = createResultView(definition, props.toolCall);
    if (result) return result;
  }
  return null;
});
function openArtifact(path: string) {
  window.dispatchEvent(new CustomEvent("agent-swarm:open-artifact", { detail: { path } }));
}
</script>

<template>
  <component
    :is="activeResult.component"
    v-if="activeResult"
    v-bind="activeResult.props"
    v-on="activeResult.listeners ?? {}"
  />
</template>
