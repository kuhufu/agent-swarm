import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptionsWithoutStdio } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createRunWorkspaceContainerTool, createRemoveWorkspaceContainersTool, createListWorkspaceContainersTool, createStartWorkspaceContainersTool, createStopWorkspaceContainersTool, createRestartWorkspaceContainersTool } from "./containers.js";
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

// ── workspace_run_container tests ────────────────────────────────────

interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptionsWithoutStdio;
  child: FakeChildProcess;
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid: number;
  killed = false;
  private closed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.close(null, "SIGTERM");
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.emit("exit", code, signal);
      this.emit("close", code, signal);
    });
  }
}

function createSpawnMock(autoClose = true) {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcess => {
    const child = new FakeChildProcess(10000 + calls.length);
    calls.push({ command, args, options, child });
    if (autoClose) {
      child.close(0);
    }
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

describe("workspace_run_container tool", () => {
  it("runs commands through docker with an isolated workspace mount", async () => {
    const workspace = createWorkspaceManager(`test-docker-${crypto.randomUUID()}`);
    const { spawn, calls } = createSpawnMock();
    const tool = createRunWorkspaceContainerTool(workspace, {
      dockerImage: "agent-workspace:test",
      spawn,
    });

    await tool.execute("call-1", { command: "node main.js", cwd: "src" });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("docker");
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.detached).toBe(true);
    expect(calls[0].args).toEqual(expect.arrayContaining([
      "run",
      "--rm",
      "--name",
      expect.stringMatching(/^agent-swarm-test-docker-/),
      "--label",
      "agent-swarm=true",
      "--label",
      `agent-swarm.conversation-id=${workspace.conversationId}`,
      "--label",
      "agent-swarm.tool-call-id=call-1",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--mount",
      `type=bind,src=${workspace.baseDir},dst=/workspace`,
      "-w",
      "/workspace/src",
      "agent-workspace:test",
      "sh",
      "-lc",
      "node main.js",
    ]));
  });

  it("kills the docker process when aborted", async () => {
    const workspace = createWorkspaceManager(`test-abort-${crypto.randomUUID()}`);
    const { spawn, calls } = createSpawnMock(false);
    const tool = createRunWorkspaceContainerTool(workspace, { spawn });
    const controller = new AbortController();

    const promise = tool.execute(
      "call-1",
      { command: "node -e \"setInterval(() => {}, 1000)\"", timeoutMs: 5000 },
      controller.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    controller.abort();
    const result = await promise;

    expect(calls[0].child.killed).toBe(true);
    expect(result.details.aborted).toBe(true);
  });

  it("reports docker daemon connection failures as infrastructure errors", async () => {
    const workspace = createWorkspaceManager(`test-docker-daemon-${crypto.randomUUID()}`);
    const calls: SpawnCall[] = [];
    const spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcess => {
      const child = new FakeChildProcess(12000);
      calls.push({ command, args, options, child });
      queueMicrotask(() => {
        child.stderr.write("docker: Cannot connect to the Docker daemon at unix:///tmp/docker.sock. Is the docker daemon running?\n");
        child.close(125);
      });
      return child as unknown as ChildProcess;
    };
    const tool = createRunWorkspaceContainerTool(workspace, { spawn });

    await expect(tool.execute("call-1", { command: "ls -la" }))
      .rejects
      .toThrow("Docker daemon 未运行");
  });

  it("binds requested ports to localhost and keeps background containers running", async () => {
    const workspace = createWorkspaceManager(`test-background-${crypto.randomUUID()}`);
    const { spawn, calls } = createSpawnMock(false);
    const tool = createRunWorkspaceContainerTool(workspace, { spawn });

    const result = await tool.execute("call-1", {
      command: "node server.js",
      background: true,
      startupWaitMs: 500,
      ports: [{ containerPort: 3000, hostPort: 3100 }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(expect.arrayContaining([
      "-p",
      "127.0.0.1:3100:3000",
    ]));
    expect(calls[0].args).not.toContain("--network");
    expect(result.details.exitCode).toBeNull();
    expect(result.details.background).toBe(true);
    expect(result.details.containerName).toMatch(/^agent-swarm-test-background-/);
    expect(result.details.ports).toEqual([{ containerPort: 3000, hostPort: 3100 }]);
  });

  it("returns the real exit result when a background container exits during startup wait", async () => {
    const workspace = createWorkspaceManager(`test-background-exit-${crypto.randomUUID()}`);
    const { spawn, calls } = createSpawnMock(false);
    const tool = createRunWorkspaceContainerTool(workspace, { spawn });

    const promise = tool.execute("call-1", {
      command: "node missing.js",
      background: true,
      startupWaitMs: 500,
      ports: [{ containerPort: 3000 }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    calls[0].child.stderr.write("Cannot find module '/workspace/missing.js'\n");
    calls[0].child.close(1);

    const result = await promise;

    expect(result.details.exitCode).toBe(1);
    expect(result.details.background).toBe(true);
    expect(result.details.stderr).toContain("Cannot find module");
  });
});
