import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { spawn } from "node:child_process";
import type { WorkspaceManager } from "./workspace.js";

const ExecuteFileParams = Type.Object({
  command: Type.String({ description: "要执行的命令，如 'node main.js' 或 'bash script.sh'" }),
  timeoutMs: Type.Optional(Type.Number({
    description: "执行超时（毫秒），默认 10000，范围 1000-30000",
    minimum: 1000,
    maximum: 30000,
  })),
  cwd: Type.Optional(Type.String({
    description: "命令执行的工作子目录（相对于工作区根目录），默认为工作区根目录",
  })),
});

interface ExecuteFileDetails {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  pid?: number;
  aborted?: boolean;
  timedOut?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10000;

export function createExecuteFileTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ExecuteFileParams, ExecuteFileDetails> {
  return {
    name: "execute_file",
    label: "执行命令",
    description: "在工作区的隔离目录中执行 shell 命令。工作区中有 write_file 写入的文件。",
    parameters: ExecuteFileParams,
    execute: async (_toolCallId, params, signal?: AbortSignal) => {
      await workspace.ensureDir();
      const cwd = params.cwd
        ? workspace.checkPath(params.cwd)
        : workspace.baseDir;

      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const command = params.command.trim();
      if (!command) {
        throw new Error("命令不能为空");
      }

      return new Promise<AgentToolResult<ExecuteFileDetails>>((resolve, reject) => {
        const child = spawn(command, {
          cwd,
          env: { ...process.env },
          shell: true,
          detached: true,
        });
        const processInfo = workspace.trackProcess(child, command);

        let stdout = "";
        let stderr = "";
        let settled = false;
        let aborted = false;
        let timedOut = false;

        const timeout = setTimeout(() => {
          timedOut = true;
          workspace.killProcess(child.pid ?? 0, "SIGTERM");
        }, timeoutMs);

        const forceKillTimeout = setTimeout(() => {
          if (!settled && (timedOut || aborted)) {
            workspace.killProcess(child.pid ?? 0, "SIGKILL");
          }
        }, timeoutMs + 1000);

        const onAbort = () => {
          aborted = true;
          workspace.killProcess(child.pid ?? 0, "SIGTERM");
          setTimeout(() => {
            if (!settled) {
              workspace.killProcess(child.pid ?? 0, "SIGKILL");
            }
          }, 1000);
        };

        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString("utf-8");
        });

        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf-8");
        });

        child.on("error", (err: Error) => {
          clearTimeout(timeout);
          clearTimeout(forceKillTimeout);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error(`命令执行失败: ${err.message}`));
        });

        child.on("close", (code: number | null, closeSignal: NodeJS.Signals | null) => {
          settled = true;
          clearTimeout(timeout);
          clearTimeout(forceKillTimeout);
          signal?.removeEventListener("abort", onAbort);
          const maxOutput = 8000;
          const truncatedStdout = stdout.length > maxOutput
            ? stdout.slice(0, maxOutput) + "\n...(stdout 已截断)"
            : stdout;
          const truncatedStderr = stderr.length > maxOutput
            ? stderr.slice(0, maxOutput) + "\n...(stderr 已截断)"
            : stderr;

          const text = [
            `命令: ${command}`,
            processInfo ? `进程: ${processInfo.pid}` : undefined,
            `退出码: ${code ?? "null"}`,
            closeSignal ? `信号: ${closeSignal}` : undefined,
            timedOut ? "状态: 已超时并终止" : undefined,
            aborted ? "状态: 已取消并终止" : undefined,
            truncatedStdout ? `stdout:\n${truncatedStdout}` : "stdout: (无输出)",
            truncatedStderr ? `stderr:\n${truncatedStderr}` : "stderr: (无输出)",
          ].filter(Boolean).join("\n");

          resolve({
            content: [{ type: "text", text }],
            details: {
              exitCode: code,
              stdout: truncatedStdout,
              stderr: truncatedStderr,
              ...(processInfo ? { pid: processInfo.pid } : {}),
              aborted,
              timedOut,
            },
          });
        });
      });
    },
  };
}
