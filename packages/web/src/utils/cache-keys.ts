import { clearMessageCache } from "./message-cache.js";

export const CACHE_KEYS = {
  USER: "cached-user",
  SWARMS: "cached-swarms",
  CONVERSATIONS: "cached-conversations",
  MODELS: "cached-models",
  AGENTS_PRESETS: "cached-agents-presets",
  AGENTS_TEMPLATES: "cached-agents-templates",
  PROVIDER_IDS: "cached-provider-ids",
} as const;

export async function clearAllCaches(): Promise<void> {
  for (const key of Object.values(CACHE_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  await clearMessageCache();
}
