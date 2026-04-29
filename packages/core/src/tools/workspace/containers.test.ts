import { describe, expect, it } from "vitest";
import { createCleanupWorkspaceContainersTool, createListWorkspaceContainersTool } from "./containers.js";
import { WorkspaceManager, createWorkspaceManager } from "./manager.js";

describe("workspace container tools", () => {
  it("lists and cleans only current workspace containers by docker label", async () => {
    const workspace = createWorkspaceManager(`test-container-tools-${crypto.randomUUID()}`);
    const dockerCalls: string[][] = [];
    const restore = WorkspaceManager.setDockerCommandRunnerForTest(async (args) => {
      dockerCalls.push(args);
      if (args.includes("--format")) {
        return `${JSON.stringify({
          ID: "abc123",
          Names: "agent-swarm-test-container",
          Image: "node:22-alpine",
          Status: "Up 2 minutes",
          Ports: "127.0.0.1:3100->3000/tcp",
        })}\n`;
      }
      if (args[0] === "ps") {
        return "abc123\n";
      }
      return "";
    });

    try {
      const listTool = createListWorkspaceContainersTool(workspace);
      const cleanupTool = createCleanupWorkspaceContainersTool(workspace);

      const listResult = await listTool.execute("list", {});
      expect(listResult.details.containers).toEqual([
        expect.objectContaining({
          id: "abc123",
          name: "agent-swarm-test-container",
        }),
      ]);

      const cleanupResult = await cleanupTool.execute("cleanup", {});
      expect(cleanupResult.details.containersRemoved).toBe(1);
      expect(dockerCalls).toContainEqual(["rm", "-f", "abc123"]);
      expect(dockerCalls).toContainEqual([
        "ps",
        "-a",
        "--filter",
        `label=agent-swarm.conversation-id=${workspace.conversationId}`,
        "--format",
        "{{json .}}",
      ]);
    } finally {
      restore();
    }
  });
});
