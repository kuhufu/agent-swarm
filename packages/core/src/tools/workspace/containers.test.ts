import { describe, expect, it } from "vitest";
import { createRemoveWorkspaceContainersTool, createListWorkspaceContainersTool, createStartWorkspaceContainersTool, createStopWorkspaceContainersTool, createRestartWorkspaceContainersTool } from "./containers.js";
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
      const cleanupTool = createRemoveWorkspaceContainersTool(workspace);

      const listResult = await listTool.execute("list", {});
      expect(listResult.details.containers).toEqual([
        expect.objectContaining({
          id: "abc123",
          name: "agent-swarm-test-container",
        }),
      ]);

      const cleanupResult = await cleanupTool.execute("cleanup", { containerNames: ["agent-swarm-test-container"] });
      expect(cleanupResult.details.containersRemoved).toBe(1);
      expect(dockerCalls).toContainEqual(["rm", "-f", "agent-swarm-test-container"]);
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

  it("cleans specified container names that belong to the current conversation", async () => {
    const workspace = createWorkspaceManager(`test-container-tools-${crypto.randomUUID()}`);
    const dockerCalls: string[][] = [];
    const restore = WorkspaceManager.setDockerCommandRunnerForTest(async (args) => {
      dockerCalls.push(args);
      if (args.includes("--format")) {
        return `${JSON.stringify({ ID: "a1", Names: "container-a", Image: "node", Status: "running", Ports: "" })}\n${JSON.stringify({ ID: "b2", Names: "container-b", Image: "node", Status: "running", Ports: "" })}\n`;
      }
      return "";
    });

    try {
      const cleanupTool = createRemoveWorkspaceContainersTool(workspace);
      const result = await cleanupTool.execute("cleanup", {
        containerNames: ["container-a", "container-b"],
      });
      expect(result.details.containersRemoved).toBe(2);
      expect(result.details.containerNames).toEqual(["container-a", "container-b"]);
      expect(dockerCalls).toContainEqual(["rm", "-f", "container-a", "container-b"]);
    } finally {
      restore();
    }
  });

  it("skips containers not belonging to the current conversation", async () => {
    const workspace = createWorkspaceManager(`test-container-tools-${crypto.randomUUID()}`);
    const dockerCalls: string[][] = [];
    const restore = WorkspaceManager.setDockerCommandRunnerForTest(async (args) => {
      dockerCalls.push(args);
      if (args.includes("--format")) {
        return `${JSON.stringify({ ID: "c3", Names: "allowed-container", Image: "node", Status: "running", Ports: "" })}\n`;
      }
      return "";
    });

    try {
      const cleanupTool = createRemoveWorkspaceContainersTool(workspace);
      const result = await cleanupTool.execute("cleanup", {
        containerNames: ["foreign-container", "allowed-container"],
      });
      expect(result.details.containersRemoved).toBe(1);
      expect(result.details.containerNames).toEqual(["foreign-container", "allowed-container"]);
      expect(dockerCalls).toContainEqual(["rm", "-f", "allowed-container"]);
      expect(dockerCalls).not.toContainEqual(expect.arrayContaining(["foreign-container"]));
    } finally {
      restore();
    }
  });

  it("returns 0 for empty containerNames array", async () => {
    const workspace = createWorkspaceManager(`test-container-tools-${crypto.randomUUID()}`);
    const dockerCalls: string[][] = [];
    const restore = WorkspaceManager.setDockerCommandRunnerForTest(async (args) => {
      dockerCalls.push(args);
      return "";
    });

    try {
      const cleanupTool = createRemoveWorkspaceContainersTool(workspace);
      const result = await cleanupTool.execute("cleanup", {
        containerNames: [],
      });
      expect(result.details.containersRemoved).toBe(0);
      expect(dockerCalls).not.toContainEqual(expect.arrayContaining(["rm"]));
    } finally {
      restore();
    }
  });

  describe("start/stop/restart containers", () => {
    function setupMock(workspace: WorkspaceManager) {
      const dockerCalls: string[][] = [];
      const restore = WorkspaceManager.setDockerCommandRunnerForTest(async (args) => {
        dockerCalls.push(args);
        if (args.includes("--format")) {
          return `${JSON.stringify({ ID: "c1", Names: "my-container", Image: "node", Status: "running", Ports: "" })}\n`;
        }
        return "";
      });
      return { dockerCalls, restore };
    }

    it("starts specified containers", async () => {
      const workspace = createWorkspaceManager(`test-start-${crypto.randomUUID()}`);
      const { dockerCalls, restore } = setupMock(workspace);
      try {
        const tool = createStartWorkspaceContainersTool(workspace);
        const result = await tool.execute("start", { containerNames: ["my-container"] });
        expect(result.details.succeeded).toBe(1);
        expect(dockerCalls).toContainEqual(["start", "my-container"]);
      } finally {
        restore();
      }
    });

    it("stops specified containers", async () => {
      const workspace = createWorkspaceManager(`test-stop-${crypto.randomUUID()}`);
      const { dockerCalls, restore } = setupMock(workspace);
      try {
        const tool = createStopWorkspaceContainersTool(workspace);
        const result = await tool.execute("stop", { containerNames: ["my-container"] });
        expect(result.details.succeeded).toBe(1);
        expect(dockerCalls).toContainEqual(["stop", "my-container"]);
      } finally {
        restore();
      }
    });

    it("restarts specified containers", async () => {
      const workspace = createWorkspaceManager(`test-restart-${crypto.randomUUID()}`);
      const { dockerCalls, restore } = setupMock(workspace);
      try {
        const tool = createRestartWorkspaceContainersTool(workspace);
        const result = await tool.execute("restart", { containerNames: ["my-container"] });
        expect(result.details.succeeded).toBe(1);
        expect(dockerCalls).toContainEqual(["restart", "my-container"]);
      } finally {
        restore();
      }
    });

    it("skips foreign containers for start", async () => {
      const workspace = createWorkspaceManager(`test-start-foreign-${crypto.randomUUID()}`);
      const { dockerCalls, restore } = setupMock(workspace);
      try {
        const tool = createStartWorkspaceContainersTool(workspace);
        const result = await tool.execute("start", { containerNames: ["my-container", "foreign"] });
        expect(result.details.succeeded).toBe(1);
        expect(dockerCalls).toContainEqual(["start", "my-container"]);
        expect(dockerCalls).not.toContainEqual(expect.arrayContaining(["foreign"]));
      } finally {
        restore();
      }
    });
  });
});
