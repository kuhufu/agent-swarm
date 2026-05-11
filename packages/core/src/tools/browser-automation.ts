import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BrowserAction = Type.Union([
  Type.Literal("open", { description: "导航到 URL" }),
  Type.Literal("snap", { description: "获取页面快照，显示可交互元素及其 ref 引用" }),
  Type.Literal("click", { description: "点击指定 ref 的元素" }),
  Type.Literal("fill", { description: "向指定 ref 的输入框填写内容" }),
  Type.Literal("screenshot", { description: "截取当前页面截图" }),
  Type.Literal("close", { description: "关闭浏览器" }),
  Type.Literal("wait", { description: "等待页面加载完成" }),
  Type.Literal("extract", { description: "提取当前页面的完整文本内容" }),
]);

const BrowserAutomationParams = Type.Object({
  action: BrowserAction,
  url: Type.Optional(Type.String({ description: "导航目标 URL（action=open 时必填）" })),
  ref: Type.Optional(Type.String({
    description: "元素引用 ID，格式 @e1、@e2 等（action=click/fill 时必填）。从 snap 操作的输出中获取。",
  })),
  value: Type.Optional(Type.String({ description: "输入值（action=fill 时必填）" })),
  userAgent: Type.Optional(Type.String({ description: "自定义 User-Agent（仅在 action=open 时生效）" })),
  waitUntil: Type.Optional(Type.String({ description: "等待条件：load/networkidle（action=wait 时使用）" })),
  timeout: Type.Optional(Type.Number({ description: "超时时间（毫秒）" })),
});

type BrowserAutomationParams = Static<typeof BrowserAutomationParams>;

async function execAgentBrowser(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("agent-browser", args, {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    const output = stdout?.trim() ?? "";
    const errOutput = stderr?.trim() ?? "";
    if (output && errOutput) {
      return `${output}\n${errOutput}`;
    }
    return output || errOutput;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        "agent-browser 未安装。请运行: npm install -g agent-browser && agent-browser install",
      );
    }
    const message = err.stderr?.trim() || err.message || String(err);
    throw new Error(`浏览器操作失败: ${message}`);
  }
}

export function createBrowserAutomationTool(): AgentTool<
  typeof BrowserAutomationParams,
  { action: string; result: string } | null
> {
  return {
    name: "browser_automation",
    label: "浏览器自动化",
    description:
      "通过 agent-browser 控制浏览器执行网页操作：打开页面、获取页面快照（含可交互元素引用 @e1/@e2）、点击元素、填写表单、截图、提取文本等。快照输出中的 @e1、@e2 等 ref 可用于后续 click/fill 操作。",
    parameters: BrowserAutomationParams,
    execute: async (
      _toolCallId: string,
      params: BrowserAutomationParams,
    ) => {
      const { action, url, ref, value, userAgent, waitUntil, timeout } = params;

      try {
        let result: string;

        switch (action) {
          case "open": {
            if (!url) {
              return {
                content: [{ type: "text", text: "❌ action=open 时 url 参数必填" }],
                details: null,
              };
            }
            const openArgs = ["open", url];
            if (timeout) openArgs.push("--timeout", String(timeout));
            if (userAgent) openArgs.push("--user-agent", userAgent);
            result = await execAgentBrowser(openArgs);
            break;
          }

          case "snap": {
            const snapArgs = ref
              ? ["snapshot", ref.startsWith("@") ? ref : `@${ref}`]
              : ["snapshot", "-i"];
            if (timeout) snapArgs.push("--timeout", String(timeout));
            result = await execAgentBrowser(snapArgs);
            break;
          }

          case "click": {
            if (!ref) {
              return {
                content: [{ type: "text", text: "❌ action=click 时 ref 参数必填（如 @e1）" }],
                details: null,
              };
            }
            result = await execAgentBrowser([
              "click",
              ref.startsWith("@") ? ref : `@${ref}`,
            ]);
            break;
          }

          case "fill": {
            if (!ref) {
              return {
                content: [{ type: "text", text: "❌ action=fill 时 ref 参数必填" }],
                details: null,
              };
            }
            if (value === undefined) {
              return {
                content: [{ type: "text", text: "❌ action=fill 时 value 参数必填" }],
                details: null,
              };
            }
            result = await execAgentBrowser([
              "fill",
              ref.startsWith("@") ? ref : `@${ref}`,
              value,
            ]);
            break;
          }

          case "screenshot": {
            result = await execAgentBrowser(["screenshot"]);
            break;
          }

          case "close": {
            result = await execAgentBrowser(["close"]);
            break;
          }

          case "wait": {
            const waitArgs = ["wait"];
            if (waitUntil) waitArgs.push("--load", waitUntil);
            if (timeout) waitArgs.push("--timeout", String(timeout));
            result = await execAgentBrowser(waitArgs);
            break;
          }

          case "extract": {
            result = await execAgentBrowser(["snapshot"]);
            break;
          }

          default: {
            return {
              content: [{ type: "text", text: `❌ 未知操作: ${action}` }],
              details: null,
            };
          }
        }

        const trimmed = result?.trim() || "操作成功完成。";
        return {
          content: [{ type: "text", text: trimmed }],
          details: { action, result: trimmed },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ ${(err as Error).message}` }],
          details: null,
        };
      }
    },
  };
}
