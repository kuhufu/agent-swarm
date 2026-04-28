import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IVectorStore, Document, DocumentChunk, SearchResult } from "./vector-store.js";

function splitTextIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export class SQLiteVectorStore implements IVectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES rag_documents(id),
        content TEXT NOT NULL,
        idx INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
        content,
        tokenize='trigram',
        content='rag_chunks',
        content_rowid='rowid'
      );
    `);
  }

  private requireUserId(userId: string | null): string {
    const normalized = userId?.trim();
    if (!normalized) {
      throw new Error("rag_documents.user_id is required");
    }
    return normalized;
  }

  async addDocument(doc: Document, chunks: DocumentChunk[]): Promise<void> {
    const insertDoc = this.db.prepare(
      "INSERT OR REPLACE INTO rag_documents (id, user_id, title, source, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const insertChunk = this.db.prepare(
      "INSERT INTO rag_chunks (id, document_id, content, idx, metadata) VALUES (?, ?, ?, ?, ?)",
    );
    const tx = this.db.transaction(() => {
      insertDoc.run(doc.id, doc.userId, doc.title, doc.source, doc.createdAt);
      for (const chunk of chunks) {
        insertChunk.run(chunk.id, doc.id, chunk.content, chunk.index, JSON.stringify(chunk.metadata ?? {}));
      }
    });
    tx();
    // rebuild must run outside transaction
    this.db.exec("INSERT INTO rag_fts(rag_fts) VALUES('rebuild')");
  }

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM rag_chunks
        WHERE document_id IN (
          SELECT id FROM rag_documents WHERE id = ? AND user_id = ?
        )
      `).run(documentId, userId);
      this.db.prepare("DELETE FROM rag_documents WHERE id = ? AND user_id = ?").run(documentId, userId);
    })();
    this.db.exec("INSERT INTO rag_fts(rag_fts) VALUES('rebuild')");
  }

  async search(query: string, topK = 5, userId?: string): Promise<SearchResult[]> {
    // trigram tokenizer handles mixed CJK/ASCII \u2014 just strip special chars
    const cleanQuery = query.replace(/[^\w\u4e00-\u9fff]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanQuery) return [];

    const baseSql = `
      SELECT c.id, c.document_id, c.content, c.idx, c.metadata,
             d.id as doc_id, d.user_id, d.title, d.source, d.created_at,
             rank
      FROM rag_fts f
      JOIN rag_chunks c ON f.rowid = c.rowid
      JOIN rag_documents d ON c.document_id = d.id
      WHERE rag_fts MATCH ?
    `;

    const sql = userId
      ? `${baseSql} AND d.user_id = ? ORDER BY rank LIMIT ?`
      : `${baseSql} ORDER BY rank LIMIT ?`;

    const params = userId ? [cleanQuery, userId, topK] : [cleanQuery, topK];

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string; document_id: string; content: string; idx: number; metadata: string;
      doc_id: string; user_id: string | null; title: string; source: string; created_at: number;
      rank: number;
    }>;

    return rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        content: r.content,
        index: r.idx,
        metadata: JSON.parse(r.metadata ?? "{}"),
      },
      document: {
        id: r.doc_id,
        userId: this.requireUserId(r.user_id),
        title: r.title,
        source: r.source,
        createdAt: r.created_at,
      },
      score: -r.rank,  // FTS5 rank is negative (lower is better)
    }));
  }

  async listDocuments(userId: string): Promise<Document[]> {
    const query = this.db.prepare("SELECT * FROM rag_documents WHERE user_id = ? ORDER BY created_at DESC");
    const rows = query.all(userId);

    return (rows as Array<{ id: string; user_id: string | null; title: string; source: string; created_at: number }>).map((r) => ({
      id: r.id,
      userId: this.requireUserId(r.user_id),
      title: r.title,
      source: r.source,
      createdAt: r.created_at,
    }));
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM rag_chunks; DELETE FROM rag_documents;");
    this.db.exec("INSERT INTO rag_fts(rag_fts) VALUES('rebuild')");
  }
}
