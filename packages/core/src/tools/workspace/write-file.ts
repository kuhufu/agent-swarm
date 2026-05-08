import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager } from "./manager.js";

const WriteFileParams = Type.Object({
  path: Type.String({ description: "写入路径（相对于工作区根目录）" }),
  content: Type.String({ description: "要写入的文件内容" }),
});

interface WriteFileDetails {
  artifact: true;
  path: string;
  size: number;
  kind: string;
  language?: string;
  previewable: boolean;
}

export function createWriteFileTool(
  workspace: WorkspaceManager,
): AgentTool<typeof WriteFileParams, WriteFileDetails> {
  return {
    name: "workspace_write_file",
    label: "写入文件",
    description: "将内容写入工作目录中的文件。自动创建父目录。",
    parameters: WriteFileParams,
    execute: async (_toolCallId, params) => {
      const totalSize = await workspace.getTotalSize();
      if (totalSize > 52_428_800) {
        throw new Error("工作区总大小超过 50MB，请先清理无用文件");
      }

      const file = await workspace.writeFile(params.path, params.content);

      return {
        content: [{ type: "text", text: `文件已写入: ${file.path} (${formatSize(file.size)})` }],
        details: {
          artifact: true,
          path: file.path,
          size: file.size,
          ...inferArtifactMeta(file.path),
          previewable: isPreviewable(file.path),
        },
      };
    },
  };
}

function inferArtifactMeta(path: string): { kind: string; language?: string } {
  const normalizedPath = path.toLowerCase();
  const filename = normalizedPath.split("/").pop() ?? normalizedPath;
  const extension = filename.split(".").pop() ?? "";
  const namedLanguage = CODE_FILENAMES[filename];
  if (namedLanguage) return { kind: "code", language: namedLanguage };
  const language = CODE_EXTENSIONS[extension];
  if (language) return { kind: "code", language };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return { kind: "image" };
  if (["md", "markdown"].includes(extension)) return { kind: "markdown" };
  if (["json"].includes(extension)) return { kind: "json" };
  if (["html", "htm"].includes(extension)) return { kind: "html" };
  if (["txt", "log", "csv", "jsonl", "xml", "yaml", "yml", "toml", "ini", "env"].includes(extension)) return { kind: "text" };
  return { kind: "file" };
}

function isPreviewable(path: string): boolean {
  return inferArtifactMeta(path).kind !== "file";
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
