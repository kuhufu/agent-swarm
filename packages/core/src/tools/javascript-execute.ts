import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Script, createContext } from "node:vm";
import { inspect } from "node:util";

const JavascriptExecuteParams = Type.Object({
  code: Type.String({ description: "JavaScript code to execute." }),
  timeoutMs: Type.Optional(Type.Number({
    description: "Execution timeout in milliseconds (50-5000). Default 2000.",
    minimum: 50,
    maximum: 5000,
  })),
});

type JavascriptExecuteParams = Static<typeof JavascriptExecuteParams>;

interface JavascriptExecuteDetails {
  code: string;
  timeoutMs: number;
  logs: string[];
  result: string;
}

const DEFAULT_TIMEOUT_MS = 2000;

interface JavascriptExecuteRemoteResult {
  content: string;
  details?: unknown;
  isError?: boolean;
}

interface JavascriptExecuteToolOptions {
  name?: string;
  label?: string;
  description?: string;
  remoteExecutor?: (
    request: { toolCallId: string; params: JavascriptExecuteParams },
  ) => Promise<JavascriptExecuteRemoteResult>;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return inspect(value, { depth: 6, colors: false, maxArrayLength: 100 });
}

/**
 * Execute JavaScript code in a constrained VM context.
 */
export function createJavascriptExecuteTool(
  options: JavascriptExecuteToolOptions = {},
): AgentTool<typeof JavascriptExecuteParams, JavascriptExecuteDetails | unknown> {
  const toolName = options.name ?? "javascript_execute";
  const toolLabel = options.label ?? "JavaScript Execute";
  const toolDescription = options.description
    ?? "Execute JavaScript snippets for calculation, transformation, and quick checks.";

  return {
    name: toolName,
    label: toolLabel,
    description: toolDescription,
    parameters: JavascriptExecuteParams,
    execute: async (
      toolCallId: string,
      params: JavascriptExecuteParams,
    ): Promise<AgentToolResult<JavascriptExecuteDetails | unknown>> => {
      if (options.remoteExecutor) {
        const remote = await options.remoteExecutor({ toolCallId, params });
        if (remote.isError) {
          throw new Error(remote.content || "JavaScript 执行失败");
        }
        return {
          content: [{
            type: "text",
            text: remote.content || "JavaScript 执行成功。",
          }],
          details: remote.details ?? {
            code: params.code,
            timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          },
        };
      }

      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const logs: string[] = [];
      const sandboxConsole = {
        log: (...args: unknown[]) => logs.push(args.map((arg) => stringifyValue(arg)).join(" ")),
        info: (...args: unknown[]) => logs.push(args.map((arg) => stringifyValue(arg)).join(" ")),
        warn: (...args: unknown[]) => logs.push(args.map((arg) => stringifyValue(arg)).join(" ")),
        error: (...args: unknown[]) => logs.push(args.map((arg) => stringifyValue(arg)).join(" ")),
      };

      const context = createContext({
        console: sandboxConsole,
        Math,
        Date,
        JSON,
        Number,
        String,
        Boolean,
        Array,
        Object,
        RegExp,
      });

      try {
        const script = new Script(`"use strict";\n(() => {\n${params.code}\n})()`);
        const result = script.runInContext(context, { timeout: timeoutMs });
        const resultText = stringifyValue(result);

        return {
          content: [{
            type: "text",
            text: [
              "JavaScript 执行成功。",
              `返回值: ${resultText}`,
              logs.length > 0 ? `日志:\n${logs.join("\n")}` : "日志: 无",
            ].join("\n"),
          }],
          details: {
            code: params.code,
            timeoutMs,
            logs,
            result: resultText,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`JavaScript 执行失败: ${message}`);
      }
    },
  };
}

export const javascriptExecuteTool = createJavascriptExecuteTool();
