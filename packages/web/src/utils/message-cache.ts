import { deleteDB, openDB, type IDBPDatabase } from "idb";
import type { ChatMessage } from "../types/index.js";

export const MESSAGE_CACHE_DB_NAME = "agent-swarm-cache";
const DB_VERSION = 2;
const STORE_NAME = "conversation-messages";

interface CachedMessages {
  conversationId: string;
  messages: ChatMessage[];
  maxCreatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(MESSAGE_CACHE_DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        db.createObjectStore(STORE_NAME, { keyPath: "conversationId" });
      },
    });
  }
  return dbPromise;
}

export async function getCachedMessages(conversationId: string): Promise<CachedMessages | undefined> {
  try {
    const db = await getDb();
    const raw = await db.get(STORE_NAME, conversationId) as CachedMessages | undefined;
    if (!raw) return undefined;
    return {
      conversationId: raw.conversationId,
      messages: raw.messages,
      maxCreatedAt: raw.maxCreatedAt,
    };
  } catch {
    return undefined;
  }
}

export async function setCachedMessages(
  conversationId: string,
  messages: ChatMessage[],
  maxCreatedAt: number,
): Promise<void> {
  try {
    const db = await getDb();
    const clean = JSON.parse(JSON.stringify(messages)) as ChatMessage[];
    await db.put(STORE_NAME, {
      conversationId,
      messages: clean,
      maxCreatedAt,
    });
  } catch (err) {
    console.error("[IDB cache] write failed:", conversationId, err);
  }
}

export async function deleteCachedMessages(conversationId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE_NAME, conversationId);
  } catch {
    // ignore cache delete failures
  }
}

export async function clearMessageCache(): Promise<void> {
  try {
    const db = dbPromise ? await dbPromise : null;
    db?.close();
  } catch {
    // ignore close failures
  } finally {
    dbPromise = null;
  }

  try {
    await deleteDB(MESSAGE_CACHE_DB_NAME);
  } catch {
    // ignore cache delete failures
  }
}
