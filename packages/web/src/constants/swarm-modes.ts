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
  router: {
    label: "Router 路由",
    labelZh: "路由",
    color: "#818cf8",
    bg: "rgba(99, 102, 241, 0.1)",
    desc: "智能路由到最合适的 Agent",
    icon: "🔀",
  },
  sequential: {
    label: "Sequential 顺序",
    labelZh: "顺序",
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.1)",
    desc: "按顺序依次执行",
    icon: "➡️",
  },
  parallel: {
    label: "Parallel 并行",
    labelZh: "并行",
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.1)",
    desc: "多个 Agent 同时执行",
    icon: "⏩",
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
export type CollaborationMode = "router" | "sequential" | "parallel" | "swarm" | "debate";

/** Mode options for selection UIs */
export const MODE_OPTIONS: { value: CollaborationMode; label: string; desc: string; icon: string }[] = [
  { value: "router", label: "Router 路由", desc: "智能路由到最合适的 Agent", icon: "🔀" },
  { value: "sequential", label: "Sequential 顺序", desc: "按顺序依次执行", icon: "➡️" },
  { value: "parallel", label: "Parallel 并行", desc: "多个 Agent 同时执行", icon: "⏩" },
  { value: "swarm", label: "Swarm 蜂群", desc: "去中心化协作", icon: "🐝" },
  { value: "debate", label: "Debate 辩论", desc: "多 Agent 辩论模式", icon: "⚖️" },
];
