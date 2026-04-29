import { describe, expect, it } from "vitest";
import { createExecuteFileTool } from "./file-execute.js";
import { createWorkspaceManager } from "./workspace.js";

describe("execute_file tool", () => {
  it("kills the running process when aborted", async () => {
    const workspace = createWorkspaceManager(`test-abort-${crypto.randomUUID()}`);
    const tool = createExecuteFileTool(workspace);
    const controller = new AbortController();

    const promise = tool.execute(
      "call-1",
      { command: "node -e \"setInterval(() => {}, 1000)\"", timeoutMs: 5000 },
      controller.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(workspace.listProcesses()).toHaveLength(1);

    controller.abort();
    const result = await promise;

    expect(result.details.aborted).toBe(true);
    expect(workspace.listProcesses()).toHaveLength(0);
  });
});
