import { executeJavascriptInFrontend } from "../utils/frontend-js-tool.js";
import { useAskUserStore } from "../stores/ask-user.js";

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
  enabledTools: string[];
}

function isToolEnabled(state: ClientToolState, toolName: string): boolean {
  return state.enabledTools.includes(toolName);
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

function askUserToolDefinition(): ClientToolDefinition {
  return {
    name: "ask_user",
    label: "Ask User",
    description: "Ask the user a concise clarification question and wait for their answer before continuing.",
    parametersSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "A concise question for the user. Ask one thing at a time.",
        },
        context: {
          type: "string",
          description: "Optional short context explaining why the answer is needed.",
        },
        multiple: {
          type: "boolean",
          description: "When true, the user can select multiple choices instead of just one.",
        },
        choices: {
          type: "array",
          items: { type: "string" },
          maxItems: 6,
        },
        defaultAnswer: {
          type: "string",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  };
}

export function buildClientToolDefinitions(state: ClientToolState): ClientToolDefinition[] {
  const tools: ClientToolDefinition[] = [];
  if (isToolEnabled(state, "current_time")) {
    tools.push(currentTimeToolDefinition());
  }
  if (isToolEnabled(state, "javascript_execute")) {
    tools.push(javascriptToolDefinition());
  }
  if (isToolEnabled(state, "ask_user")) {
    tools.push(askUserToolDefinition());
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
    if (!isToolEnabled(state, "javascript_execute")) {
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

  if (toolName === "ask_user") {
    if (!isToolEnabled(state, "ask_user")) {
      return {
        isError: true,
        content: "ask_user 工具已关闭",
      };
    }

    const question = typeof params?.question === "string" ? params.question.trim() : "";
    if (!question) {
      return {
        isError: true,
        content: "参数错误：question 不能为空",
      };
    }

    const context = typeof params?.context === "string" ? params.context : undefined;
    const defaultAnswer = typeof params?.defaultAnswer === "string" ? params.defaultAnswer : undefined;
    const choices = Array.isArray(params?.choices)
      ? params.choices.filter((choice): choice is string => typeof choice === "string")
      : [];
    const multiple = params?.multiple === true;

    return useAskUserStore().requestAnswer({
      question,
      context,
      choices,
      defaultAnswer,
      multiple,
    });
  }

  return {
    isError: true,
    content: `不支持的前端工具: ${toolName}`,
  };
}
