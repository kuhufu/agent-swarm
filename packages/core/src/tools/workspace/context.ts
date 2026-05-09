import type { FileInfo, GrepMatch } from "./manager.js";

export interface WorkspaceFileMeta {
  kind: string;
  language?: string;
  previewable: boolean;
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
