import type { FileInfo, GrepMatch } from "./manager.js";

export interface WorkspaceFileMeta {
  kind: string;
  language?: string;
  previewable: boolean;
}

export interface WorkspaceNextAction {
  tool: string;
  reason: string;
  params?: Record<string, unknown>;
}

export function inferWorkspaceFileMeta(path: string): WorkspaceFileMeta {
  const normalizedPath = path.toLowerCase();
  const filename = normalizedPath.split("/").pop() ?? normalizedPath;
  const extension = filename.split(".").pop() ?? "";
  const namedLanguage = CODE_FILENAMES[filename];
  if (namedLanguage) return { kind: "code", language: namedLanguage, previewable: true };
  const language = CODE_EXTENSIONS[extension];
  if (language) return { kind: "code", language, previewable: true };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extension)) return { kind: "image", previewable: true };
  if (["md", "markdown"].includes(extension)) return { kind: "markdown", previewable: true };
  if (extension === "json") return { kind: "json", previewable: true };
  if (["html", "htm"].includes(extension)) return { kind: "html", language: "xml", previewable: true };
  if (["txt", "log", "csv", "jsonl", "xml", "yaml", "yml", "toml", "ini", "env"].includes(extension)) return { kind: "text", previewable: true };
  return { kind: "file", previewable: false };
}

export function formatWorkspaceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function summarizeWorkspaceFiles(files: FileInfo[], limit = 80): string {
  const visible = files.slice(0, limit);
  const lines = visible.map((file) => {
    const depth = Math.max(0, file.path.split("/").length - 1);
    const indent = "  ".repeat(depth);
    const meta = inferWorkspaceFileMeta(file.path);
    return `${indent}- ${file.path} (${meta.kind}, ${formatWorkspaceSize(file.size)})`;
  });
  if (files.length > visible.length) {
    lines.push(`...还有 ${files.length - visible.length} 个文件未显示，可用 path/recursive 缩小范围`);
  }
  return lines.join("\n");
}

export function summarizeGrepMatches(matches: GrepMatch[], limit = 80): string {
  const visible = matches.slice(0, limit);
  const lines = visible.map((match) => `  ${match.path}:${match.line}  ${match.content}`);
  if (matches.length > visible.length) {
    lines.push(`...还有 ${matches.length - visible.length} 处匹配未显示，可提高 maxResults 或收窄 include`);
  }
  return lines.join("\n");
}

export function buildWorkspaceNextActions(input: {
  paths?: string[];
  directory?: string;
  hasMatches?: boolean;
  canRun?: boolean;
  artifactPath?: string;
}): WorkspaceNextAction[] {
  const actions: WorkspaceNextAction[] = [];
  const firstPath = input.paths?.find((path) => path.trim().length > 0);

  if (firstPath) {
    actions.push({
      tool: "workspace_read_file",
      reason: input.hasMatches ? "读取匹配文件的完整上下文后再修改或分析" : "读取目标文件内容后再修改或分析",
      params: { path: firstPath },
    });
    actions.push({
      tool: "workspace_grep",
      reason: "在相关文件中继续定位符号、函数名或文本片段",
      params: { pattern: "<关键词或正则>", include: input.directory ? `${input.directory}/**/*` : undefined },
    });
  } else {
    actions.push({
      tool: "workspace_list_files",
      reason: "先查看工作区文件，再选择要读取、搜索或执行的路径",
      params: { path: input.directory ?? ".", recursive: true },
    });
  }

  if (input.artifactPath) {
    const hasReadAction = actions.some((action) => action.tool === "workspace_read_file" && action.params?.path === input.artifactPath);
    if (!hasReadAction) {
      actions.push({
        tool: "workspace_read_file",
        reason: "确认刚写入的文件内容",
        params: { path: input.artifactPath },
      });
    }
  }

  if (input.canRun) {
    actions.push({
      tool: "workspace_run_container",
      reason: "在隔离容器内运行脚本、测试或构建命令验证结果",
      params: { command: "<验证命令>" },
    });
  }

  return actions;
}

const CODE_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "package.json": "json",
  "tsconfig.json": "json",
};

const CODE_EXTENSIONS: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  scala: "scala",
};
