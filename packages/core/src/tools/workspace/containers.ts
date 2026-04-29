import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceContainerInfo, WorkspaceManager } from "./manager.js";

const EmptyParams = Type.Object({});

const ContainerNamesParams = Type.Object({
  containerNames: Type.Array(Type.String()),
});

interface ListWorkspaceContainersDetails {
  containers: WorkspaceContainerInfo[];
}

interface CleanupWorkspaceContainersDetails {
  containersRemoved: number;
  containerNames: string[];
}

interface OperationContainersDetails {
  containerNames: string[];
  succeeded: number;
}

export function createListWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof EmptyParams, ListWorkspaceContainersDetails> {
  return {
    name: "workspace_list_containers",
    label: "列出工作区容器",
    description: "列出当前会话 workspace 中由 workspace_run_container 创建的 Docker 容器。容器通过 agent-swarm.conversation-id label 关联到当前会话，因此服务重启后仍可查询；只能查看当前会话，不能访问其他会话或任意宿主机容器。",
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

export function createRemoveWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ContainerNamesParams, CleanupWorkspaceContainersDetails> {
  return {
    name: "workspace_remove_containers",
    label: "清理工作区容器",
    description: "停止并删除当前会话 workspace 中由 workspace_run_container 创建的 Docker 容器（仅删除属于当前会话的容器）。必须指定 containerNames。",
    parameters: ContainerNamesParams,
    execute: async (_ctx, params): Promise<AgentToolResult<CleanupWorkspaceContainersDetails>> => {
      const removed = await workspace.removeContainers(params.containerNames);
      return {
        content: [{
          type: "text",
          text: `已清理 ${removed} 个指定容器。`,
        }],
        details: { containersRemoved: removed, containerNames: params.containerNames },
      };
    },
  };
}

export function createStartWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ContainerNamesParams, OperationContainersDetails> {
  return {
    name: "workspace_start_containers",
    label: "启动工作区容器",
    description: "启动当前会话 workspace 中已停止的 Docker 容器（仅限属于当前会话的容器）。",
    parameters: ContainerNamesParams,
    execute: async (_ctx, params): Promise<AgentToolResult<OperationContainersDetails>> => {
      const { containerNames } = params;
      const succeeded = await workspace.startContainers(containerNames);
      return {
        content: [{
          type: "text",
          text: `已启动 ${succeeded}/${containerNames.length} 个容器。`,
        }],
        details: { containerNames, succeeded },
      };
    },
  };
}

export function createStopWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ContainerNamesParams, OperationContainersDetails> {
  return {
    name: "workspace_stop_containers",
    label: "停止工作区容器",
    description: "停止当前会话 workspace 中正在运行的 Docker 容器（仅限属于当前会话的容器）。",
    parameters: ContainerNamesParams,
    execute: async (_ctx, params): Promise<AgentToolResult<OperationContainersDetails>> => {
      const { containerNames } = params;
      const succeeded = await workspace.stopContainers(containerNames);
      return {
        content: [{
          type: "text",
          text: `已停止 ${succeeded}/${containerNames.length} 个容器。`,
        }],
        details: { containerNames, succeeded },
      };
    },
  };
}

export function createRestartWorkspaceContainersTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ContainerNamesParams, OperationContainersDetails> {
  return {
    name: "workspace_restart_containers",
    label: "重启工作区容器",
    description: "重启当前会话 workspace 中的 Docker 容器（仅限属于当前会话的容器）。",
    parameters: ContainerNamesParams,
    execute: async (_ctx, params): Promise<AgentToolResult<OperationContainersDetails>> => {
      const { containerNames } = params;
      const succeeded = await workspace.restartContainers(containerNames);
      return {
        content: [{
          type: "text",
          text: `已重启 ${succeeded}/${containerNames.length} 个容器。`,
        }],
        details: { containerNames, succeeded },
      };
    },
  };
}
