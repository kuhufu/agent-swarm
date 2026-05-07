import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { WebSearchConfig } from "./web-search.js";

// Reuse proxy logic from web-search
function resolveProxy(config: WebFetchConfig): { url?: string; noProxy?: string } {
  if (config.proxy) return { url: config.proxy, noProxy: config.noProxy };
  const env = typeof process !== "undefined" ? process.env as Record<string, string | undefined> : {};
  const get = (keys: string[]) => {
    for (const key of keys) {
      const v = env[key];
      if (v) return v;
    }
    return undefined;
  };
  return {
    url: get(["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"]),
    noProxy: config.noProxy ?? get(["no_proxy", "NO_PROXY"]),
  };
}

function shouldBypassProxy(url: string, noProxy?: string): boolean {
  if (!noProxy) return false;
  const hostname = new URL(url).hostname;
  return noProxy.split(",").some((rule) => {
    const trimmed = rule.trim();
    if (!trimmed) return false;
    if (trimmed === "*") return true;
    if (trimmed.startsWith(".")) return hostname.endsWith(trimmed) || hostname === trimmed.slice(1);
    return hostname === trimmed || hostname.endsWith(`.${trimmed}`);
  });
}

async function proxyFetch(url: string, init?: RequestInit, config?: WebFetchConfig): Promise<Response> {
  const proxy = resolveProxy(config ?? {} as WebFetchConfig);
  if (proxy.url && !shouldBypassProxy(url, proxy.noProxy)) {
    const agent = new ProxyAgent(proxy.url);
    return undiciFetch(url, { ...init, dispatcher: agent } as any);
  }
  return fetch(url, init);
}

export interface WebFetchConfig {
  /** HTTP/HTTPS 代理地址，如 http://127.0.0.1:7890 */
  proxy?: string;
  /** 不使用代理的地址列表，逗号分隔 */
  noProxy?: string;
  /** 请求超时毫秒数，默认 30000 */
  timeout?: number;
  /** 最大响应体大小（字节），默认 1MB */
  maxContentSize?: number;
  /** 允许的域名白名单，为空则允许所有域名 */
  allowedDomains?: string[];
  /** 阻止的域名黑名单 */
  blockedDomains?: string[];
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  description?: string;
  contentType: string;
}

const FetchParams = Type.Object({
  url: Type.String({ description: "要获取内容的网页 URL" }),
  /** 可选的提取目标：full（全文）或 main（主体内容，默认 main） */
  mode: Type.Optional(
    Type.Union([Type.Literal("full"), Type.Literal("main")], { description: "提取模式：full=全文，main=主体内容（默认 main）", default: "main" }),
  ),
});

type FetchParams = Static<typeof FetchParams>;

function validateUrl(url: string, config: WebFetchConfig): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`无效的 URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`仅支持 HTTP/HTTPS 协议，当前协议: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (config.blockedDomains?.length) {
    for (const domain of config.blockedDomains) {
      const d = domain.toLowerCase();
      if (hostname === d || hostname.endsWith(`.${d}`)) {
        throw new Error(`域名 ${hostname} 被安全策略阻止`);
      }
    }
  }

  if (config.allowedDomains?.length) {
    const allowed = config.allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith(`.${d}`);
    });
    if (!allowed) {
      throw new Error(`域名 ${hostname} 不在允许列表中`);
    }
  }
}

/** 简易 HTML → 纯文本转换，去除标签、脚本、样式 */
function htmlToText(html: string, mode: "full" | "main"): { title: string; content: string; description?: string } {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";

  // Extract <meta name="description">
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
    ?? html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
  const description = descMatch?.[1]?.trim();

  // Remove unwanted sections
  let cleaned = html;

  if (mode === "main") {
    // Try to extract <main>, <article>, or role="main" content first
    const mainMatch = cleaned.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i)
      ?? cleaned.match(/<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/\w+>/i);
    if (mainMatch?.[1]) {
      cleaned = mainMatch[1];
    }
  }

  // Remove script, style, noscript, svg tags
  cleaned = cleaned.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  // Remove all tags
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  cleaned = cleaned.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();

  // Truncate if too long (roughly 50K chars)
  if (cleaned.length > 50000) {
    cleaned = cleaned.slice(0, 50000) + "\n\n...(内容已截断)";
  }

  return { title, content: cleaned, description };
}

export function createWebFetchTool(config: WebFetchConfig = {}): AgentTool<typeof FetchParams, WebFetchResult | null> {
  return {
    name: "web_fetch",
    label: "获取网页内容",
    description: "获取指定 URL 的网页内容并提取文本。返回网页标题、正文内容等信息。适用于需要阅读网页全文的场景。",
    parameters: FetchParams,
    execute: async (_toolCallId: string, params: FetchParams): Promise<AgentToolResult<WebFetchResult | null>> => {
      const mode = params.mode ?? "main";
      const timeout = config.timeout ?? 30000;
      const maxContentSize = config.maxContentSize ?? 1024 * 1024; // 1MB

      try {
        validateUrl(params.url, config);
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ ${(err as Error).message}` }],
          details: null,
        };
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        response = await proxyFetch(params.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AgentSwarm/1.0; +web_fetch)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
        }, config);
        clearTimeout(timeoutId);
      } catch (err) {
        const msg = (err as Error).name === "AbortError"
          ? `请求超时（${timeout}ms）`
          : `请求失败: ${(err as Error).message}`;
        return {
          content: [{ type: "text", text: `❌ ${msg}` }],
          details: null,
        };
      }

      if (!response.ok) {
        return {
          content: [{ type: "text", text: `❌ HTTP ${response.status} ${response.statusText}` }],
          details: null,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const contentLength = Number(response.headers.get("content-length") ?? 0);

      // Reject oversized responses early
      if (contentLength > maxContentSize) {
        return {
          content: [{ type: "text", text: `❌ 响应体过大（${(contentLength / 1024).toFixed(0)}KB），上限 ${(maxContentSize / 1024).toFixed(0)}KB` }],
          details: null,
        };
      }

      // Handle non-HTML content
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        if (contentType.includes("text/") || contentType.includes("json") || contentType.includes("xml")) {
          // Plain text / JSON / XML — return as-is (truncated)
          let text: string;
          try {
            text = await response.text();
          } catch {
            return {
              content: [{ type: "text", text: "❌ 无法读取响应内容" }],
              details: null,
            };
          }
          if (text.length > 50000) {
            text = text.slice(0, 50000) + "\n\n...(内容已截断)";
          }
          const result: WebFetchResult = {
            url: params.url,
            title: new URL(params.url).pathname.split("/").pop() ?? "",
            content: text,
            contentType,
          };
          return {
            content: [{ type: "text", text: `📄 **${result.title}**\n\n${result.content}` }],
            details: result,
          };
        }

        // Binary or unsupported content type
        return {
          content: [{ type: "text", text: `❌ 不支持的内容类型: ${contentType}` }],
          details: null,
        };
      }

      // HTML content
      let html: string;
      try {
        html = await response.text();
      } catch {
        return {
          content: [{ type: "text", text: "❌ 无法读取网页内容" }],
          details: null,
        };
      }

      if (html.length > maxContentSize) {
        return {
          content: [{ type: "text", text: `❌ 网页内容过大（${(html.length / 1024).toFixed(0)}KB），上限 ${(maxContentSize / 1024).toFixed(0)}KB` }],
          details: null,
        };
      }

      const { title, content, description } = htmlToText(html, mode);
      const result: WebFetchResult = {
        url: params.url,
        title,
        content,
        description,
        contentType,
      };

      const header = description
        ? `📄 **${title}**\n> ${description}\n`
        : `📄 **${title}**\n`;

      return {
        content: [{ type: "text", text: `${header}\n${content}` }],
        details: result,
      };
    },
  };
}
