export interface GraphNode {
  id: string;
  label: string;
  status: "idle" | "thinking" | "executing_tool" | "handing_off" | "error";
  model?: string;
  messages: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "handoff" | "route" | "sequential" | "parallel";
}

export type GraphLayout = "chain" | "star" | "grid" | "triangle";

/**
 * Build graph data from the current agent states and swarm mode.
 * Returns nodes and edges suitable for visualization.
 */
export function buildWorkflowGraph(
  agents: GraphNode[],
  mode?: string,
): { nodes: GraphNode[]; edges: GraphEdge[]; layout: GraphLayout } {
  const nodes = agents.filter((a) => a.id !== "router");
  const edges: GraphEdge[] = [];

  const normalizedMode = typeof mode === "string" ? mode : "";

  switch (normalizedMode) {
    case "sequential": {
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          from: nodes[i].id,
          to: nodes[i + 1].id,
          type: "sequential",
        });
      }
      return { nodes, edges, layout: "chain" };
    }

    case "parallel": {
      return { nodes, edges, layout: "grid" };
    }

    case "debate": {
      if (nodes.length >= 2) {
        edges.push({ from: nodes[0].id, to: nodes[1].id, type: "handoff" });
        edges.push({ from: nodes[1].id, to: nodes[0].id, type: "handoff" });
        if (nodes.length >= 3) {
          edges.push({ from: nodes[0].id, to: nodes[2].id, type: "handoff" });
          edges.push({ from: nodes[1].id, to: nodes[2].id, type: "handoff" });
        }
      }
      return { nodes, edges, layout: "triangle" };
    }

    case "router":
    case "swarm":
    default: {
      // Find orchestrator if present
      const routerNode = agents.find((a) => a.id === "router");
      const workerNodes = routerNode
        ? nodes.filter((a) => a.id !== "router")
        : nodes;

      if (routerNode && workerNodes.length > 0) {
        for (const worker of workerNodes) {
          edges.push({ from: routerNode.id, to: worker.id, type: "route" });
        }
        return { nodes: [routerNode, ...workerNodes], edges, layout: "star" };
      }

      // Swarm mode: who talked to whom — build edges from handoff interactions
      return { nodes, edges, layout: "grid" };
    }
  }
}

export function getStatusColor(status: GraphNode["status"]): string {
  switch (status) {
    case "idle": return "var(--color-text-muted)";
    case "thinking": return "var(--color-accent)";
    case "executing_tool": return "var(--color-warning)";
    case "handing_off": return "var(--color-info)";
    case "error": return "var(--color-danger)";
  }
}

export function getStatusLabel(status: GraphNode["status"]): string {
  switch (status) {
    case "idle": return "空闲";
    case "thinking": return "思考中";
    case "executing_tool": return "执行工具";
    case "handing_off": return "交接中";
    case "error": return "错误";
  }
}
