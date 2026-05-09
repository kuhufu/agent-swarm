import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createListFilesTool } from "./list-files.js";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createGrepTool } from "./grep.js";
import { WorkspaceManager, createWorkspaceManager } from "./manager.js";

describe("workspace tool context", () => {
  let workspace: WorkspaceManager;

  beforeEach(async () => {
    workspace = createWorkspaceManager(`test-workspace-context-${crypto.randomUUID()}`);
    await workspace.writeFile("src/app.ts", "export const answer = 42;\n");
    await workspace.writeFile("README.md", "# Demo\n\nanswer\n");
  });

  afterEach(async () => {
    await workspace.cleanup().catch(() => {});
  });

  it("lists concrete paths and next actions for downstream tools", async () => {
    const tool = createListFilesTool(workspace);
    const result = await tool.execute("list", {});
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain("src/app.ts");
    expect(text).toContain("README.md");
    expect(result.details.count).toBe(2);
    expect(result.details.directories).toEqual(["src"]);
  });

  it("returns file metadata when reading code", async () => {
    const tool = createReadFileTool(workspace);
    const result = await tool.execute("read", { path: "src/app.ts" });

    expect(result.details.meta).toMatchObject({ kind: "code", language: "typescript", previewable: true });
  });

  it("returns artifact metadata when writing files", async () => {
    const tool = createWriteFileTool(workspace);
    const result = await tool.execute("write", { path: "src/new.ts", content: "export const value = 1;\n" });

    expect(result.details).toMatchObject({
      artifact: true,
      path: "src/new.ts",
      kind: "code",
      language: "typescript",
      previewable: true,
    });
  });

  it("returns matched paths for grep results", async () => {
    const tool = createGrepTool(workspace);
    const result = await tool.execute("grep", { pattern: "answer" });

    expect(result.details.matchedPaths).toEqual(["README.md", "src/app.ts"]);
  });
});
