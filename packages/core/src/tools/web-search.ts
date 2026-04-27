import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { fetch as undiciFetch, ProxyAgent } from "undici";

export type SearchProvider = "duckduckgo" | "tavily" | "brave" | "serpapi";

export interface WebSearchConfig {
  provider: SearchProvider;
  apiKey?: string;
  maxResults?: number;
  /** HTTP/HTTPS 代理地址，如 http://127.0.0.1:7890 */
  proxy?: string;
  /** 不使用代理的地址列表，逗号分隔 */
  noProxy?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 解析代理配置：优先用 config 指定的，其次读环境变量 */
function resolveProxy(config: WebSearchConfig): { url?: string; noProxy?: string } {
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

/** 判断 URL 是否应绕过代理 */
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

/** 代理感知的 fetch */
async function proxyFetch(url: string, init?: RequestInit, config?: WebSearchConfig): Promise<Response> {
  const proxy = resolveProxy(config ?? {} as WebSearchConfig);
  if (proxy.url && !shouldBypassProxy(url, proxy.noProxy)) {
    const agent = new ProxyAgent(proxy.url);
    return undiciFetch(url, { ...init, dispatcher: agent } as any);
  }
  return fetch(url, init);
}

const SearchParams = Type.Object({
  query: Type.String({ description: "搜索查询词" }),
  maxResults: Type.Optional(
    Type.Number({ description: "返回结果数量上限", default: 5 }),
  ),
});

type SearchParams = Static<typeof SearchParams>;

async function searchDuckDuckGo(query: string, maxResults: number, config: WebSearchConfig): Promise<SearchResult[]> {
  const text = await proxyFetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
  }, config).then((r) => r.text());

  const results: SearchResult[] = [];
  const linkMatches = text.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g);
  const snippetMatches = [...text.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

  let idx = 0;
  for (const match of linkMatches) {
    if (results.length >= maxResults) break;
    const url = match[1]?.replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, "") ?? "";
    const title = match[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const snippet = snippetMatches[idx]?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if (url && title) {
      results.push({ title, url: decodeURIComponent(url), snippet });
    }
    idx++;
  }

  return results;
}

async function searchTavily(apiKey: string, query: string, maxResults: number, config: WebSearchConfig): Promise<SearchResult[]> {
  const response = await proxyFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      include_answer: false,
    }),
  }, config);

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`);
  }

  const data = (await response.json()) as { results: Array<{ title: string; url: string; content: string }> };
  return data.results.slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchWeb(config: WebSearchConfig, query: string, maxResults: number): Promise<SearchResult[]> {
  switch (config.provider) {
    case "duckduckgo":
      return searchDuckDuckGo(query, maxResults, config);
    case "tavily":
      if (!config.apiKey) throw new Error("Tavily 需要配置 apiKey");
      return searchTavily(config.apiKey, query, maxResults, config);
    case "brave":
      if (!config.apiKey) throw new Error("Brave Search 需要配置 apiKey");
      // Brave Search API
      const braveResp = await proxyFetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
        { headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": config.apiKey } },
        config,
      );
      if (!braveResp.ok) throw new Error(`Brave API error: ${braveResp.status}`);
      const braveData = (await braveResp.json()) as { web?: { results: Array<{ title: string; url: string; description: string }> } };
      return (braveData.web?.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title, url: r.url, snippet: r.description,
      }));
    case "serpapi":
      if (!config.apiKey) throw new Error("SerpAPI 需要配置 apiKey");
      const serpResp = await proxyFetch(
        `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${config.apiKey}&engine=google&num=${maxResults}`,
        undefined,
        config,
      );
      if (!serpResp.ok) throw new Error(`SerpAPI error: ${serpResp.status}`);
      const serpData = (await serpResp.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
      return (serpData.organic_results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title, url: r.link, snippet: r.snippet,
      }));
    default:
      throw new Error(`不支持的搜索引擎: ${config.provider}`);
  }
}

export function createWebSearchTool(config: WebSearchConfig): AgentTool<typeof SearchParams, SearchResult[]> {
  return {
    name: "web_search",
    label: "搜索互联网",
    description: [
      "搜索互联网获取最新信息。返回搜索结果列表，包含标题、URL 和摘要。",
      config.provider === "duckduckgo"
        ? "当前使用 DuckDuckGo（免费）。"
        : `当前使用 ${config.provider}。`,
    ].join(" "),
    parameters: SearchParams,
    execute: async (toolCallId: string, params: SearchParams): Promise<AgentToolResult<SearchResult[]>> => {
      const maxResults = params.maxResults ?? config.maxResults ?? 5;
      let results: SearchResult[];
      try {
        results = await searchWeb(config, params.query, maxResults);
      } catch (err) {
        const errorMsg = (err as Error).message;
        const fallbackMsg = config.provider === "duckduckgo"
          ? "DuckDuckGo 在当前网络不可用，请在服务端配置 webSearchConfig 改用 Tavily/Brave/SerpAPI。"
          : `搜索失败: ${errorMsg}`;
        return {
          content: [{ type: "text", text: `❌ ${fallbackMsg}` }],
          details: [],
        };
      }
      const output = results.length > 0
        ? results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`).join("\n\n")
        : "未找到相关结果。";
      return {
        content: [{ type: "text", text: output }],
        details: results,
      };
    },
  };
}
