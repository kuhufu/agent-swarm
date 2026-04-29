import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createGrepTool } from "./grep.js";
import { WorkspaceManager, createWorkspaceManager } from "./manager.js";

describe("workspace_grep tool", () => {
  let workspace: WorkspaceManager;

  beforeEach(async () => {
    workspace = createWorkspaceManager(`test-grep-${crypto.randomUUID()}`);
    const restore = WorkspaceManager.setDockerCommandRunnerForTest(async () => "");
    await workspace.writeFile("hello.txt", "hello world\nfoo bar\nhello again\n");
    await workspace.writeFile("data.json", '{"hello": "world"}\n{"foo": "bar"}\n');
    restore();
  });

  afterEach(async () => {
    await workspace.cleanup().catch(() => {});
  });

  it("searches files in workspace", async () => {
    const tool = createGrepTool(workspace);
    const result = await tool.execute("grep", { pattern: "hello" });
    expect(result.details.total).toBe(3);
    const paths = [...new Set(result.details.matches.map((m) => m.path))].sort();
    expect(paths).toEqual(["data.json", "hello.txt"]);
  });

  it("filters by include pattern", async () => {
    const tool = createGrepTool(workspace);
    const result = await tool.execute("grep", { pattern: "hello", include: "*.json" });
    expect(result.details.total).toBe(1);
    expect(result.details.matches[0].path).toBe("data.json");
  });

  it("returns 0 matches for non-existing pattern", async () => {
    const tool = createGrepTool(workspace);
    const result = await tool.execute("grep", { pattern: "nonexistent" });
    expect(result.details.total).toBe(0);
    expect(result.details.matches).toEqual([]);
  });

  it("limits results", async () => {
    const tool = createGrepTool(workspace);
    const result = await tool.execute("grep", { pattern: "hello", maxResults: 1 });
    expect(result.details.total).toBe(1);
  });
});
