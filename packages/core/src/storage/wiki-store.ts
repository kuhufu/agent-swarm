export interface WikiPage {
  id: string;
  userId: string;
  title: string;
  summary: string;
  content: string;
  aliases: string[];
  tags: string[];
  status: "draft" | "active" | "stale";
  sourceDocumentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WikiClaim {
  id: string;
  pageId: string;
  text: string;
  sourceDocumentId?: string;
  sourceChunkIndex?: number;
  confidence?: number;
}

export interface WikiLink {
  id: string;
  fromPageId: string;
  toPageId?: string;
  toTitle: string;
  relation: "related" | "prerequisite" | "explains" | "contradicts" | "part_of";
}

export interface WikiPageDetail extends WikiPage {
  claims: WikiClaim[];
  links: WikiLink[];
}

export interface WikiSearchResult {
  page: WikiPage;
  claims: WikiClaim[];
  score: number;
}

export interface WikiPageInput {
  title: string;
  summary: string;
  content: string;
  aliases?: string[];
  tags?: string[];
  status?: WikiPage["status"];
  sourceDocumentIds?: string[];
  claims?: Array<Omit<WikiClaim, "id" | "pageId">>;
  links?: Array<Omit<WikiLink, "id" | "fromPageId" | "toPageId"> & { toPageId?: string }>;
}

export interface IWikiStore {
  init(): Promise<void>;
  listPages(userId: string): Promise<WikiPage[]>;
  getPage(pageId: string, userId: string): Promise<WikiPageDetail | null>;
  createPage(userId: string, input: WikiPageInput): Promise<WikiPageDetail>;
  updatePage(pageId: string, userId: string, input: Partial<WikiPageInput>): Promise<WikiPageDetail>;
  deletePage(pageId: string, userId: string): Promise<void>;
  search(query: string, topK: number | undefined, userId: string): Promise<WikiSearchResult[]>;
  clear(): Promise<void>;
}
