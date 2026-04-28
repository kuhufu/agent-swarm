export interface Document {
  id: string;
  userId: string;
  title: string;
  source: string;
  createdAt: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  chunk: DocumentChunk;
  document: Document;
  score: number;
}

export interface IVectorStore {
  init(): Promise<void>;
  addDocument(doc: Document, chunks: DocumentChunk[]): Promise<void>;
  deleteDocument(documentId: string, userId: string): Promise<void>;
  search(query: string, topK?: number, userId?: string): Promise<SearchResult[]>;
  listDocuments(userId: string): Promise<Document[]>;
  clear(): Promise<void>;
}
