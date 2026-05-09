import type { ToolCallInfo } from "../../types/index.js";

export interface WorkspaceArtifact {
  path: string;
  size?: number;
  kind?: string;
}

export interface WorkspaceNextAction {
  tool: string;
  reason: string;
  params?: Record<string, unknown>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  description?: string;
  contentType: string;
}

export interface WorkspaceFileMeta {
  kind: string;
  language?: string;
  previewable: boolean;
}

export interface WorkspaceReadFileDetails {
  path: string;
  size: number;
  truncated: boolean;
  meta: WorkspaceFileMeta;
}

export interface WorkspaceFileInfo {
  path: string;
  size: number;
  type: "file" | "dir";
  updatedAt?: number;
}

export interface WorkspaceListFilesDetails {
  files: WorkspaceFileInfo[];
  count: number;
  totalSize: number;
  directories: string[];
}

export interface WorkspaceGrepMatch {
  path: string;
  line: number;
  content: string;
}

export interface WorkspaceGrepDetails {
  matches: WorkspaceGrepMatch[];
  total: number;
  matchedPaths: string[];
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "网页搜索",
  web_fetch: "抓取网页",
  browser_automation: "浏览器操作",
  retrieve_knowledge: "知识库检索",
  search_wiki: "Wiki 搜索",
  javascript_execute: "执行 JavaScript",
  current_time: "获取时间",
  handoff: "交接 Agent",
  route_to_agent: "路由到 Agent",
  workspace_read_file: "读取文件",
  workspace_write_file: "写入文件",
  workspace_list_files: "文件列表",
  workspace_grep: "搜索文件内容",
  workspace_run_container: "运行容器",
  workspace_list_containers: "容器列表",
  workspace_start_containers: "启动容器",
  workspace_stop_containers: "停止容器",
  workspace_restart_containers: "重启容器",
  workspace_remove_containers: "移除容器",
  workspace_pull_image: "拉取镜像",
  workspace_docker_exec: "执行 Docker 命令",
};

const TOOL_CATEGORY = [
  { prefixes: ["web_search", "web_fetch", "browser_automation"], cls: "search" },
  { prefixes: ["retrieve_knowledge", "search_wiki"], cls: "knowledge" },
  { prefixes: ["javascript_execute", "current_time"], cls: "code" },
  { prefixes: ["handoff", "route_to_agent"], cls: "handoff" },
  { prefixes: ["workspace_"], cls: "file" },
];

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export function getToolColorClass(name: string): string {
  for (const cat of TOOL_CATEGORY) {
    if (cat.prefixes.some((prefix) => name.startsWith(prefix))) {
      return cat.cls;
    }
  }
  return "";
}

export function getToolStatus(toolCall: ToolCallInfo): { label: string; cls: string } {
  if (toolCall.isError === true) {
    return { label: "失败", cls: "error" };
  }
  if (toolCall.details !== undefined) {
    return { label: "完成", cls: "success" };
  }
  return { label: "运行中", cls: "running" };
}

export function getToolStatusIcon(toolCall: ToolCallInfo): string {
  if (toolCall.isError === true) return "close";
  if (toolCall.details !== undefined) return "check";
  return "wrench";
}

export function getToolParamSummary(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const raw = args as Record<string, unknown>;
  if (typeof raw.query === "string" && raw.query) return raw.query;
  if (typeof raw.pattern === "string" && raw.pattern) return raw.pattern;
  if (typeof raw.path === "string" && raw.path) return raw.path;
  return null;
}

export function formatDuration(ms?: number): string | null {
  if (ms === undefined || ms === null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function getWorkspaceFileKindLabel(kind: string): string {
  const map: Record<string, string> = {
    code: "代码",
    file: "文件",
    html: "HTML",
    image: "图片",
    json: "JSON",
    markdown: "Markdown",
    text: "文本",
  };
  return map[kind] ?? kind;
}

export function isWorkspaceContainerTool(name: string): boolean {
  return name.startsWith("workspace_")
    && !["workspace_read_file", "workspace_list_files", "workspace_grep", "workspace_write_file"].includes(name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractWebSearchResults(toolCall: ToolCallInfo): WebSearchResult[] | null {
  if (toolCall.name !== "web_search" || !Array.isArray(toolCall.details)) return null;
  return toolCall.details as WebSearchResult[];
}

export function extractWebFetchResult(toolCall: ToolCallInfo): WebFetchResult | null {
  if (toolCall.name !== "web_fetch") return null;
  const details = asRecord(toolCall.details);
  if (!details) return null;
  return details as unknown as WebFetchResult;
}

export function extractWorkspaceReadFileDetails(toolCall: ToolCallInfo): WorkspaceReadFileDetails | null {
  if (toolCall.name !== "workspace_read_file") return null;
  const details = asRecord(toolCall.details);
  if (!details || typeof details.path !== "string") return null;
  return details as unknown as WorkspaceReadFileDetails;
}

export function extractWorkspaceListFilesDetails(toolCall: ToolCallInfo): WorkspaceListFilesDetails | null {
  if (toolCall.name !== "workspace_list_files") return null;
  const details = asRecord(toolCall.details);
  if (!details || !Array.isArray(details.files)) return null;
  return details as unknown as WorkspaceListFilesDetails;
}

export function extractWorkspaceGrepDetails(toolCall: ToolCallInfo): WorkspaceGrepDetails | null {
  if (toolCall.name !== "workspace_grep") return null;
  const details = asRecord(toolCall.details);
  if (!details || !Array.isArray(details.matches)) return null;
  return details as unknown as WorkspaceGrepDetails;
}

export function formatToolArguments(toolCall: ToolCallInfo): string {
  if (toolCall.arguments !== undefined) {
    return JSON.stringify(toolCall.arguments, null, 2);
  }
  return toolCall.argumentsText ?? "";
}

export function formatToolContent(toolCall: ToolCallInfo): string {
  if (!toolCall.content) return "";
  return toolCall.content.map((item: any) => item.text ?? "").join("\n");
}

export function extractWorkspaceArtifact(details: unknown, toolName: string): WorkspaceArtifact | null {
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

export function extractNextActions(details: unknown): WorkspaceNextAction[] | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const raw = details as Record<string, unknown>;
  const nextActions = raw.nextActions;
  if (!Array.isArray(nextActions) || nextActions.length === 0) return null;
  return nextActions as WorkspaceNextAction[];
}
