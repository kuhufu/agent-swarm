/**
 * Swarm collaboration mode configuration.
 * Single source of truth for mode labels, colors, descriptions.
 */

export interface ModeConfig {
  label: string;
  /** Short Chinese label */
  labelZh: string;
  color: string;
  bg: string;
  desc: string;
  icon: string;
}

const MODE_CONFIGS: Record<string, ModeConfig> = {
  chat: {
    label: "Chat 直接",
    labelZh: "直接",
    color: "#818cf8",
    bg: "rgba(129, 140, 248, 0.1)",
    desc: "单 Agent 直接对话",
    icon: "💬",
  },
  swarm: {
    label: "Swarm 蜂群",
    labelZh: "蜂群",
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.1)",
    desc: "去中心化协作",
    icon: "🐝",
  },
  debate: {
    label: "Debate 辩论",
    labelZh: "辩论",
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.1)",
    desc: "多 Agent 辩论模式",
    icon: "⚖️",
  },
  team: {
    label: "Team 团队",
    labelZh: "团队",
    color: "#9aaa64",
    bg: "rgba(154, 170, 100, 0.12)",
    desc: "Owner 路由的通用团队协作",
    icon: "▦",
  },
};

const DEFAULT_MODE_CONFIG: ModeConfig = {
  label: "Unknown",
  labelZh: "未知",
  color: "#9ca3af",
  bg: "rgba(255, 255, 255, 0.05)",
  desc: "",
  icon: "❓",
};

export function getModeConfig(mode: string): ModeConfig {
  return MODE_CONFIGS[mode] ?? DEFAULT_MODE_CONFIG;
}

/** Short Chinese mode label map (for sidebar / status displays) */
export const MODE_LABEL_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(MODE_CONFIGS).map(([key, cfg]) => [key, cfg.labelZh]),
);

/** Mode options for selection UIs */
export type CollaborationMode = "chat" | "swarm" | "debate" | "team";

/** Mode options for selection UIs */
export const MODE_OPTIONS: { value: CollaborationMode; label: string; desc: string; icon: string }[] = [
  { value: "swarm", label: "Swarm 蜂群", desc: "去中心化协作", icon: "🐝" },
  { value: "team", label: "Team 团队", desc: "Owner 路由协作", icon: "▦" },
  { value: "chat", label: "Chat 直接", desc: "单 Agent 直接对话", icon: "💬" },
  { value: "debate", label: "Debate 辩论", desc: "多 Agent 辩论模式", icon: "⚖️" },
];
