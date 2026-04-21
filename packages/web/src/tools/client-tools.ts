import { executeJavascriptInFrontend } from "../utils/frontend-js-tool.js";

export interface ClientToolDefinition {
  name: string;
  label: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
}

export interface ClientToolExecutionResult {
  isError: boolean;
  content: string;
  details?: unknown;
}

interface ClientToolState {
  jsExecutionToolEnabled: boolean;
}

function currentTimeToolDefinition(): ClientToolDefinition {
  return {
    name: "current_time",
    label: "Current Time",
    description: "Get current local date and time from the user's browser.",
    parametersSchema: {
      type: "object",
      properties: {
        locale: {
          type: "string",
          description: "Optional BCP 47 locale, e.g. zh-CN or en-US.",
        },
      },
      additionalProperties: false,
    },
  };
}

function javascriptToolDefinition(): ClientToolDefinition {
  return {
    name: "javascript_execute",
    label: "JavaScript Execute",
    description: "Execute runnable JavaScript code in the browser for calculation, transformation, and quick checks.",
    parametersSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Must be runnable JavaScript statements (not plain text). Use executable code and preferably `return` the final value.",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds (50-5000). Default 2000.",
          minimum: 50,
          maximum: 5000,
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  };
}

export function buildClientToolDefinitions(state: ClientToolState): ClientToolDefinition[] {
  const tools: ClientToolDefinition[] = [currentTimeToolDefinition()];
  if (state.jsExecutionToolEnabled) {
    tools.push(javascriptToolDefinition());
  }
  return tools;
}

export async function executeClientTool(
  toolName: string,
  params: Record<string, unknown> | undefined,
  state: ClientToolState,
): Promise<ClientToolExecutionResult> {
  if (toolName === "current_time") {
    const locale = typeof params?.locale === "string" && params.locale.trim().length > 0
      ? params.locale.trim()
      : undefined;
    const now = new Date();
    const localeText = now.toLocaleString(locale);

    return {
      isError: false,
      content: [
        `本地时间: ${localeText}`,
        `ISO: ${now.toISOString()}`,
        `时间戳(ms): ${now.getTime()}`,
        `时区偏移(分钟): ${-now.getTimezoneOffset()}`,
      ].join("\n"),
      details: {
        locale: locale ?? "system-default",
        localTime: localeText,
        iso: now.toISOString(),
        timestamp: now.getTime(),
        timezoneOffsetMinutes: -now.getTimezoneOffset(),
      },
    };
  }

  if (toolName === "javascript_execute") {
    if (!state.jsExecutionToolEnabled) {
      return {
        isError: true,
        content: "前端 JS 工具已关闭",
      };
    }

    const code = typeof params?.code === "string" ? params.code : "";
    if (!code.trim()) {
      return {
        isError: true,
        content: "参数错误：code 不能为空",
      };
    }

    const timeoutMs = typeof params?.timeoutMs === "number" ? params.timeoutMs : 1500;
    const executed = await executeJavascriptInFrontend(code, timeoutMs);
    const status = executed.isError ? "失败" : "成功";
    const logsText = executed.logs.length > 0 ? executed.logs.join("\n") : "无";

    return {
      isError: executed.isError,
      content: [
        `执行${status}`,
        `返回: ${executed.result}`,
        `日志:\n${logsText}`,
      ].join("\n"),
      details: {
        code,
        logs: executed.logs,
        result: executed.result,
      },
    };
  }

  return {
    isError: true,
    content: `不支持的前端工具: ${toolName}`,
  };
}
