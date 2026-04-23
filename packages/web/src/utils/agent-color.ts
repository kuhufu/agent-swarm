/**
 * Deterministic agent color assignment based on agent ID hash.
 * Shared across AgentStatus, MessageItem, and other components.
 */

const COLORS = [
  "#6366f1", "#3b82f6", "#a855f7", "#f59e0b",
  "#10b981", "#ef4444", "#ec4899", "#06b6d4",
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function agentColor(id?: string): string {
  if (!id) return "var(--color-accent)";
  return COLORS[hashId(id) % COLORS.length];
}
