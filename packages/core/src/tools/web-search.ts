import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export type SearchProvider = "duckduckgo" | "tavily" | "brave" | "serpapi";

export interface WebSearchConfig {
  provider: SearchProvider;
  apiKey?: string;
  maxResults?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SearchParams = Type.Object({
  query: Type.String({ description: "搜索查询词" }),
  maxResults: Type.Optional(
    Type.Number({ description: "返回结果数量上限", default: 5 }),
  ),
});

type SearchParams = Static<typeof SearchParams>;

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const text = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
  }).then((r) => r.text());

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

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
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
  });

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
      return searchDuckDuckGo(query, maxResults);
    case "tavily":
      if (!config.apiKey) throw new Error("Tavily 需要配置 apiKey");
      return searchTavily(config.apiKey, query, maxResults);
    case "brave":
      if (!config.apiKey) throw new Error("Brave Search 需要配置 apiKey");
      // Brave Search API
      const braveResp = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
        { headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": config.apiKey } },
      );
      if (!braveResp.ok) throw new Error(`Brave API error: ${braveResp.status}`);
      const braveData = (await braveResp.json()) as { web?: { results: Array<{ title: string; url: string; description: string }> } };
      return (braveData.web?.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title, url: r.url, snippet: r.description,
      }));
    case "serpapi":
      if (!config.apiKey) throw new Error("SerpAPI 需要配置 apiKey");
      const serpResp = await fetch(
        `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${config.apiKey}&engine=google&num=${maxResults}`,
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
      const results = await searchWeb(config, params.query, maxResults);
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
