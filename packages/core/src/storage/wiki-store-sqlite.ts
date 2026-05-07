import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  IWikiStore,
  WikiClaim,
  WikiLink,
  WikiPage,
  WikiPageDetail,
  WikiPageInput,
  WikiSearchResult,
} from "./wiki-store.js";

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringifyArray(value: string[] | undefined): string {
  return JSON.stringify(Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))));
}

function buildFtsQuery(query: string): string {
  const terms = query
    .replace(/[^\w\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
}

function normalizeStatus(status: unknown): WikiPage["status"] {
  return status === "draft" || status === "stale" || status === "active" ? status : "active";
}

export class SQLiteWikiStore implements IWikiStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        aliases TEXT NOT NULL,
        tags TEXT NOT NULL,
        status TEXT NOT NULL,
        source_document_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wiki_claims (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        source_document_id TEXT,
        source_chunk_index INTEGER,
        confidence REAL
      );
      CREATE TABLE IF NOT EXISTS wiki_links (
        id TEXT PRIMARY KEY,
        from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        to_page_id TEXT,
        to_title TEXT NOT NULL,
        relation TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
        title,
        summary,
        content,
        aliases,
        tags,
        tokenize='trigram',
        content='wiki_pages',
        content_rowid='rowid'
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_user ON wiki_pages(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_wiki_claims_page ON wiki_claims(page_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_links_from ON wiki_links(from_page_id);
    `);
    this.db.exec("INSERT INTO wiki_fts(wiki_fts) VALUES('rebuild')");
  }

  async listPages(userId: string): Promise<WikiPage[]> {
    const rows = this.db.prepare("SELECT * FROM wiki_pages WHERE user_id = ? ORDER BY updated_at DESC").all(userId);
    return (rows as PageRow[]).map(mapPageRow);
  }

  async getPage(pageId: string, userId: string): Promise<WikiPageDetail | null> {
    const row = this.db.prepare("SELECT * FROM wiki_pages WHERE id = ? AND user_id = ?").get(pageId, userId) as PageRow | undefined;
    if (!row) return null;
    return this.hydratePage(mapPageRow(row));
  }

  async createPage(userId: string, input: WikiPageInput): Promise<WikiPageDetail> {
    const now = Date.now();
    const page: WikiPage = {
      id: randomUUID(),
      userId,
      title: normalizeRequiredText(input.title, "title"),
      summary: normalizeRequiredText(input.summary, "summary"),
      content: normalizeRequiredText(input.content, "content"),
      aliases: input.aliases ?? [],
      tags: input.tags ?? [],
      status: normalizeStatus(input.status),
      sourceDocumentIds: input.sourceDocumentIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.writePage(page, input.claims ?? [], input.links ?? []);
    return this.hydratePage(page);
  }

  async updatePage(pageId: string, userId: string, input: Partial<WikiPageInput>): Promise<WikiPageDetail> {
    const existing = await this.getPage(pageId, userId);
    if (!existing) {
      throw new Error(`Wiki page not found: ${pageId}`);
    }
    const next: WikiPage = {
      ...existing,
      title: input.title !== undefined ? normalizeRequiredText(input.title, "title") : existing.title,
      summary: input.summary !== undefined ? normalizeRequiredText(input.summary, "summary") : existing.summary,
      content: input.content !== undefined ? normalizeRequiredText(input.content, "content") : existing.content,
      aliases: input.aliases ?? existing.aliases,
      tags: input.tags ?? existing.tags,
      status: normalizeStatus(input.status ?? existing.status),
      sourceDocumentIds: input.sourceDocumentIds ?? existing.sourceDocumentIds,
      updatedAt: Date.now(),
    };
    this.writePage(next, input.claims ?? existing.claims, input.links ?? existing.links);
    return this.hydratePage(next);
  }

  async deletePage(pageId: string, userId: string): Promise<void> {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM wiki_pages WHERE id = ? AND user_id = ?").get(pageId, userId);
      if (!row) return;
      this.db.prepare("DELETE FROM wiki_links WHERE from_page_id = ?").run(pageId);
      this.db.prepare("DELETE FROM wiki_claims WHERE page_id = ?").run(pageId);
      this.db.prepare("DELETE FROM wiki_pages WHERE id = ? AND user_id = ?").run(pageId, userId);
    })();
    this.db.exec("INSERT INTO wiki_fts(wiki_fts) VALUES('rebuild')");
  }

  async search(query: string, topK: number | undefined, userId: string): Promise<WikiSearchResult[]> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const limit = topK ?? 5;
    const rows = this.db.prepare(`
      SELECT p.*, rank
      FROM wiki_fts f
      JOIN wiki_pages p ON f.rowid = p.rowid
      WHERE wiki_fts MATCH ? AND p.user_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, userId, limit) as Array<PageRow & { rank: number }>;

    return rows.map((row) => {
      const page = mapPageRow(row);
      return {
        page,
        claims: this.listClaims(page.id).slice(0, 5),
        score: -row.rank,
      };
    });
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM wiki_links; DELETE FROM wiki_claims; DELETE FROM wiki_pages;");
    this.db.exec("INSERT INTO wiki_fts(wiki_fts) VALUES('rebuild')");
  }

  private writePage(
    page: WikiPage,
    claims: Array<Omit<WikiClaim, "id" | "pageId"> | WikiClaim>,
    links: Array<(Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }) | WikiLink>,
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO wiki_pages
        (id, user_id, title, summary, content, aliases, tags, status, source_document_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        page.id,
        page.userId,
        page.title,
        page.summary,
        page.content,
        stringifyArray(page.aliases),
        stringifyArray(page.tags),
        page.status,
        stringifyArray(page.sourceDocumentIds),
        page.createdAt,
        page.updatedAt,
      );
      this.db.prepare("DELETE FROM wiki_claims WHERE page_id = ?").run(page.id);
      this.db.prepare("DELETE FROM wiki_links WHERE from_page_id = ?").run(page.id);

      const insertClaim = this.db.prepare(`
        INSERT INTO wiki_claims (id, page_id, text, source_document_id, source_chunk_index, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const claim of claims) {
        if (!claim.text?.trim()) continue;
        insertClaim.run(
          "id" in claim ? claim.id : randomUUID(),
          page.id,
          claim.text.trim(),
          claim.sourceDocumentId ?? null,
          claim.sourceChunkIndex ?? null,
          claim.confidence ?? null,
        );
      }

      const insertLink = this.db.prepare(`
        INSERT INTO wiki_links (id, from_page_id, to_page_id, to_title, relation)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const link of links) {
        if (!link.toTitle?.trim()) continue;
        insertLink.run(
          "id" in link ? link.id : randomUUID(),
          page.id,
          link.toPageId ?? null,
          link.toTitle.trim(),
          normalizeRelation(link.relation),
        );
      }
    });
    tx();
    this.db.exec("INSERT INTO wiki_fts(wiki_fts) VALUES('rebuild')");
  }

  private hydratePage(page: WikiPage): WikiPageDetail {
    return {
      ...page,
      claims: this.listClaims(page.id),
      links: this.listLinks(page.id),
    };
  }

  private listClaims(pageId: string): WikiClaim[] {
    const rows = this.db.prepare("SELECT * FROM wiki_claims WHERE page_id = ? ORDER BY rowid ASC").all(pageId) as ClaimRow[];
    return rows.map((row) => ({
      id: row.id,
      pageId: row.page_id,
      text: row.text,
      sourceDocumentId: row.source_document_id ?? undefined,
      sourceChunkIndex: row.source_chunk_index ?? undefined,
      confidence: row.confidence ?? undefined,
    }));
  }

  private listLinks(pageId: string): WikiLink[] {
    const rows = this.db.prepare("SELECT * FROM wiki_links WHERE from_page_id = ? ORDER BY rowid ASC").all(pageId) as LinkRow[];
    return rows.map((row) => ({
      id: row.id,
      fromPageId: row.from_page_id,
      toPageId: row.to_page_id ?? undefined,
      toTitle: row.to_title,
      relation: normalizeRelation(row.relation),
    }));
  }
}

interface PageRow {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  content: string;
  aliases: string | null;
  tags: string | null;
  status: string;
  source_document_ids: string | null;
  created_at: number;
  updated_at: number;
}

interface ClaimRow {
  id: string;
  page_id: string;
  text: string;
  source_document_id: string | null;
  source_chunk_index: number | null;
  confidence: number | null;
}

interface LinkRow {
  id: string;
  from_page_id: string;
  to_page_id: string | null;
  to_title: string;
  relation: string;
}

function mapPageRow(row: PageRow): WikiPage {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    aliases: parseJsonArray(row.aliases),
    tags: parseJsonArray(row.tags),
    status: normalizeStatus(row.status),
    sourceDocumentIds: parseJsonArray(row.source_document_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`wiki page ${field} is required`);
  }
  return normalized;
}

function normalizeRelation(value: unknown): WikiLink["relation"] {
  if (
    value === "prerequisite"
    || value === "explains"
    || value === "contradicts"
    || value === "part_of"
    || value === "related"
  ) {
    return value;
  }
  return "related";
}
