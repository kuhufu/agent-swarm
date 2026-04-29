import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceContainerInfo, WorkspaceManager } from "./manager.js";

const EmptyParams = Type.Object({});

const CleanupContainersParams = Type.Object({
  containerNames: Type.Optional(Type.Array(Type.String())),
});

interface ListWorkspaceContainersDetails {
  containers: WorkspaceContainerInfo[];
}

interface CleanupWorkspaceContainersDetails {
  containersRemoved: number;
  containerNames?: string[];
}

export function createListWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof EmptyParams, ListWorkspaceContainersDetails> {
  return {
    name: "workspace_list_containers",
    label: "列出工作区容器",
    description: "列出当前会话 workspace 中由 workspace_execute 创建的 Docker 容器。容器通过 agent-swarm.conversation-id label 关联到当前会话，因此服务重启后仍可查询；只能查看当前会话，不能访问其他会话或任意宿主机容器。",
    parameters: EmptyParams,
    execute: async (): Promise<AgentToolResult<ListWorkspaceContainersDetails>> => {
      const containers = await workspace.listContainers();
      if (containers.length === 0) {
        return {
          content: [{ type: "text", text: "当前会话没有关联的 workspace Docker 容器。" }],
          details: { containers: [] },
        };
      }

      const containerText = [
        "Docker 容器:",
        containers.map((container) => [
          `id: ${container.id}`,
          `name: ${container.name}`,
          `image: ${container.image}`,
          `status: ${container.status}`,
          container.ports ? `ports: ${container.ports}` : undefined,
        ].filter(Boolean).join("\n")).join("\n---\n"),
      ].join("\n");

      return {
        content: [{
          type: "text",
          text: containerText,
        }],
        details: { containers },
      };
    },
  };
}

export function createCleanupWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof CleanupContainersParams, CleanupWorkspaceContainersDetails> {
  return {
    name: "workspace_cleanup_containers",
    label: "清理工作区容器",
    description: "停止并删除当前会话 workspace 中由 workspace_execute 创建的 Docker 容器。可指定 containerNames 按容器名删除（仅删除属于当前会话的容器），未指定时按当前会话 Docker label 批量清理。",
    parameters: CleanupContainersParams,
    execute: async (_ctx, params): Promise<AgentToolResult<CleanupWorkspaceContainersDetails>> => {
      const { containerNames } = params;
      if (containerNames !== undefined && containerNames.length > 0) {
        const removed = await workspace.removeContainers(containerNames);
        return {
          content: [{
            type: "text",
            text: `已清理 ${removed} 个指定容器。`,
          }],
          details: { containersRemoved: removed, containerNames },
        };
      }
      const containersRemoved = await workspace.cleanupContainers();
      return {
        content: [{
          type: "text",
          text: containersRemoved > 0
            ? `已按当前会话 label 清理 ${containersRemoved} 个 Docker 容器。`
            : "当前会话没有需要清理的 workspace Docker 容器。",
        }],
        details: { containersRemoved },
      };
    },
  };
}
