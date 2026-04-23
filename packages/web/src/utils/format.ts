/**
 * Time formatting utilities.
 * Centralizes the various formatTime implementations scattered across components.
 */

/** Short time format: HH:mm (e.g. "14:05") */
export function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** Locale time format: "14:05" (zh-CN) */
export function formatTimeLocale(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Long date-time format: "2025年4月23日 14:05" */
export function formatTimeLong(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
