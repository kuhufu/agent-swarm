import { complete } from "@mariozechner/pi-ai";
import type { LLMBackendConfig } from "../types.js";
import { resolveModelFromProvider, API_KEY_PLACEHOLDER } from "../../llm/provider.js";
import type { Logger } from "../../logger/types.js";
import type { IWikiStore, WikiClaim, WikiLink, WikiPage, WikiPageDetail, WikiPageInput } from "../../storage/wiki-store.js";

export class WikiGenerator {
  private getLLMConfig: () => LLMBackendConfig;
  private wikiStore: IWikiStore;
  private logger: Logger;

  constructor(getLLMConfig: () => LLMBackendConfig, wikiStore: IWikiStore, logger: Logger) {
    this.getLLMConfig = getLLMConfig;
    this.wikiStore = wikiStore;
    this.logger = logger;
  }

  async generateWikiPagesFromDocument(input: {
    userId: string;
    documentId: string;
    title: string;
    content: string;
  }): Promise<{ pages: WikiPageDetail[]; generatedBy: "llm" | "fallback" }> {
    const normalizedUserId = input.userId;
    const text = input.content.trim();
    if (!text) {
      throw new Error("document content is required");
    }

    const drafts = await this.generateWikiDrafts(input.title, text, input.documentId);
    const pages: WikiPageDetail[] = [];
    const existingPages = await this.wikiStore.listPages(normalizedUserId);
    for (const draft of drafts.pages) {
      const matched = await this.findMatchingWikiPage(normalizedUserId, draft, existingPages);
      if (matched) {
        const updated = await this.wikiStore.updatePage(
          matched.id,
          normalizedUserId,
          mergeWikiPage(matched, draft, input.documentId),
        );
        pages.push(updated);
        const index = existingPages.findIndex((page) => page.id === updated.id);
        if (index >= 0) {
          existingPages[index] = updated;
        }
        continue;
      }

      const created = await this.wikiStore.createPage(normalizedUserId, draft);
      pages.push(created);
      existingPages.push(created);
    }
    return {
      pages,
      generatedBy: drafts.generatedBy,
    };
  }

  private async findMatchingWikiPage(
    userId: string,
    draft: WikiPageInput,
    existingPages: WikiPage[],
  ): Promise<WikiPageDetail | null> {
    const draftKeys = new Set([
      normalizeWikiKey(draft.title),
      ...(draft.aliases ?? []).map(normalizeWikiKey),
    ].filter(Boolean));

    const matched = existingPages.find((page) => {
      const pageKeys = [
        normalizeWikiKey(page.title),
        ...page.aliases.map(normalizeWikiKey),
      ].filter(Boolean);
      return pageKeys.some((key) => draftKeys.has(key));
    });

    if (!matched) {
      return null;
    }
    return this.wikiStore.getPage(matched.id, userId);
  }

  private async generateWikiDrafts(
    title: string,
    content: string,
    documentId: string,
  ): Promise<{ pages: WikiPageInput[]; generatedBy: "llm" | "fallback" }> {
    const savedModel = this.getLLMConfig().models?.[0];
    if (!savedModel) {
      return { pages: [this.createFallbackWikiPage(title, content, documentId)], generatedBy: "fallback" };
    }

    try {
      const model = resolveModelFromProvider(savedModel.provider, savedModel.modelId, this.getLLMConfig());
      const prompt = [
        "你是一个知识库架构师。请把用户提供的资料整理成 1 到 5 个可维护的 Wiki 页面。",
        "只返回严格 JSON，不要 Markdown，不要代码块。",
        "JSON 格式：",
        "{\"pages\":[{\"title\":\"\",\"summary\":\"\",\"content\":\"\",\"aliases\":[\"\"],\"tags\":[\"\"],\"claims\":[{\"text\":\"\",\"confidence\":0.8}],\"links\":[{\"toTitle\":\"\",\"relation\":\"related\"}]}]}",
        "要求：",
        "- title 是清晰概念名或流程名。",
        "- summary 用 1-2 句话概括。",
        "- content 用中文 Markdown，包含关键规则、流程、注意事项。",
        "- claims 是可追溯事实点，必须来自原文。",
        "- links.relation 只能是 related/prerequisite/explains/contradicts/part_of。",
        "- 不要编造原文没有的信息。",
        "",
        `资料标题：${title}`,
        "资料正文：",
        content.slice(0, 24_000),
      ].join("\n");

      const message = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: this.getLLMConfig().apiKeys?.[savedModel.provider] || API_KEY_PLACEHOLDER,
          maxTokens: 4096,
          temperature: 0.2,
        },
      );

      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      const pages = parseWikiDrafts(text, documentId);
      if (pages.length > 0) {
        return { pages, generatedBy: "llm" };
      }
    } catch (error) {
      this.logger.warn("wiki_generation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { pages: [this.createFallbackWikiPage(title, content, documentId)], generatedBy: "fallback" };
  }

  private createFallbackWikiPage(title: string, content: string, documentId: string): WikiPageInput {
    const normalizedTitle = title.trim() || "未命名资料";
    const paragraphs = content.split(/\n\n+/).map((item) => item.trim()).filter(Boolean);
    const summary = paragraphs[0]?.slice(0, 220) || content.slice(0, 220);
    return {
      title: normalizedTitle,
      summary,
      content: content.slice(0, 8000),
      aliases: [],
      tags: [],
      status: "active",
      sourceDocumentIds: [documentId],
      claims: paragraphs.slice(0, 8).map((paragraph) => ({
        text: paragraph.slice(0, 280),
        sourceDocumentId: documentId,
        confidence: 0.5,
      })),
      links: [],
    };
  }
}

// ── Module-level wiki helpers ──

export function parseWikiDrafts(rawText: string, documentId: string): WikiPageInput[] {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const pages = Array.isArray(root?.pages) ? root.pages : [];
    return pages
      .map((item) => normalizeWikiDraft(item, documentId))
      .filter((item): item is WikiPageInput => item !== null);
  } catch {
    return [];
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function normalizeWikiDraft(value: unknown, documentId: string): WikiPageInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = normalizeString(raw.title);
  const summary = normalizeString(raw.summary);
  const content = normalizeString(raw.content);
  if (!title || !summary || !content) return null;

  const claims = Array.isArray(raw.claims)
    ? raw.claims
      .map((claim) => normalizeWikiClaimDraft(claim, documentId))
      .filter((claim): claim is NonNullable<ReturnType<typeof normalizeWikiClaimDraft>> => claim !== null)
    : [];
  const links = Array.isArray(raw.links)
    ? raw.links
      .map(normalizeWikiLinkDraft)
      .filter((link): link is NonNullable<ReturnType<typeof normalizeWikiLinkDraft>> => link !== null)
    : [];

  return {
    title,
    summary,
    content,
    aliases: normalizeStringArray(raw.aliases),
    tags: normalizeStringArray(raw.tags),
    status: "active",
    sourceDocumentIds: [documentId],
    claims,
    links,
  };
}

export function mergeWikiPage(existing: WikiPageDetail, draft: WikiPageInput, documentId: string): Partial<WikiPageInput> {
  const mergedContent = existing.content.includes(draft.content)
    ? existing.content
    : [
      existing.content,
      `## 来源补充 ${documentId.slice(0, 8)}`,
      draft.content,
    ].join("\n\n");

  return {
    title: existing.title,
    summary: mergeSummary(existing.summary, draft.summary),
    content: mergedContent,
    aliases: uniqueStrings([...existing.aliases, ...(draft.aliases ?? [])]),
    tags: uniqueStrings([...existing.tags, ...(draft.tags ?? [])]),
    status: "active",
    sourceDocumentIds: uniqueStrings([...existing.sourceDocumentIds, documentId, ...(draft.sourceDocumentIds ?? [])]),
    claims: mergeClaims(existing.claims, draft.claims ?? []),
    links: mergeLinks(existing.links, draft.links ?? []),
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function normalizeWikiClaimDraft(value: unknown, documentId: string): NonNullable<WikiPageInput["claims"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = normalizeString(raw.text);
  if (!text) return null;
  return {
    text,
    sourceDocumentId: documentId,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
  };
}

function normalizeWikiLinkDraft(value: unknown): NonNullable<WikiPageInput["links"]>[number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const toTitle = normalizeString(raw.toTitle);
  if (!toTitle) return null;
  const relation = raw.relation === "prerequisite"
    || raw.relation === "explains"
    || raw.relation === "contradicts"
    || raw.relation === "part_of"
    || raw.relation === "related"
    ? raw.relation
    : "related";
  return { toTitle, relation };
}

function mergeSummary(existing: string, incoming: string): string {
  const normalizedIncoming = incoming.trim();
  if (!normalizedIncoming || existing.includes(normalizedIncoming)) return existing;
  if (normalizeWikiKey(existing) === normalizeWikiKey(normalizedIncoming)) return existing;
  return `${existing}\n${normalizedIncoming}`.slice(0, 800);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalizeWikiKey(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function mergeClaims(
  existing: WikiClaim[],
  incoming: NonNullable<WikiPageInput["claims"]>,
): Array<Omit<WikiClaim, "id" | "pageId"> | WikiClaim> {
  const seen = new Set<string>();
  const result: Array<Omit<WikiClaim, "id" | "pageId"> | WikiClaim> = [];
  for (const claim of [...existing, ...incoming]) {
    const key = normalizeWikiKey(claim.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(claim);
  }
  return result;
}

function mergeLinks(
  existing: WikiLink[],
  incoming: NonNullable<WikiPageInput["links"]>,
): Array<(Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }) | WikiLink> {
  const seen = new Set<string>();
  const result: Array<(Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }) | WikiLink> = [];
  for (const link of [...existing, ...incoming]) {
    const key = `${normalizeWikiKey(link.relation)}:${normalizeWikiKey(link.toTitle)}`;
    if (!link.toTitle.trim() || seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

function normalizeWikiKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
