import { mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const WORKSPACE_ROOT = join(tmpdir(), "agent-workspaces");
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_WORKSPACE_SIZE = 52_428_800; // 50MB
const MAX_READ_SIZE = 10240; // 10KB

export interface FileInfo {
  path: string;
  size: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  content: string;
}

export interface WorkspaceContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
}

export class WorkspaceManager {
  static dockerCommandRunner: (args: string[]) => Promise<string> = dockerStdout;

  readonly conversationId: string;
  readonly baseDir: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
    this.baseDir = resolve(WORKSPACE_ROOT, conversationId);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  checkPath(relativePath: string): string {
    const raw = join(this.baseDir, relativePath);
    const resolved = resolve(raw);
    if (!resolved.startsWith(this.baseDir + "/") && resolved !== this.baseDir) {
      throw new Error(`路径不允许逃逸工作目录: ${relativePath}`);
    }
    return resolved;
  }

  async writeFile(relativePath: string, content: string): Promise<FileInfo> {
    await this.ensureDir();
    const fullPath = this.checkPath(relativePath);

    if (Buffer.byteLength(content, "utf-8") > MAX_FILE_SIZE) {
      throw new Error(`文件过大（最大 1MB）: ${relativePath}`);
    }

    await mkdir(resolve(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");

    const fileStat = await stat(fullPath);
    return { path: relativePath, size: fileStat.size };
  }

  async readFile(relativePath: string, maxLines?: number): Promise<{ content: string; size: number; truncated: boolean }> {
    const fullPath = this.checkPath(relativePath);

    const fileStat = await stat(fullPath).catch(() => {
      throw new Error(`文件不存在: ${relativePath}`);
    });
    if (!fileStat.isFile()) {
      throw new Error(`不是文件: ${relativePath}`);
    }

    const raw = await readFile(fullPath, "utf-8");
    let content = raw.slice(0, MAX_READ_SIZE);
    let truncated = raw.length > MAX_READ_SIZE;

    if (maxLines !== undefined && maxLines > 0) {
      const lines = content.split("\n");
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join("\n");
        truncated = true;
      }
    }

    return { content, size: fileStat.size, truncated };
  }

  async listFiles(relativePath?: string): Promise<FileInfo[]> {
    await this.ensureDir();
    const target = relativePath ? this.checkPath(relativePath) : this.baseDir;
    const results: FileInfo[] = [];

    const dirStat = await stat(target).catch(() => {
      throw new Error(`目录不存在: ${relativePath ?? "/"}`);
    });
    if (!dirStat.isDirectory()) {
      const fileStat = await stat(target);
      return [{ path: relativePath ?? ".", size: fileStat.size }];
    }

    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(target, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(entryPath, join(relativePath ?? "", entry.name));
        results.push(...subFiles);
      } else {
        const fileStat = await stat(entryPath);
        results.push({
          path: relativePath ? join(relativePath, entry.name) : entry.name,
          size: fileStat.size,
        });
      }
    }

    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }

  private async collectFiles(dir: string, prefix: string): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(dir, entry.name);
        const relPath = join(prefix, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.collectFiles(entryPath, relPath);
          results.push(...sub);
        } else {
          const fileStat = await stat(entryPath);
          results.push({ path: relPath, size: fileStat.size });
        }
      }
    } catch {
      // ignore unreadable
    }
    return results;
  }

  async getTotalSize(): Promise<number> {
    try {
      const files = await this.listFiles();
      return files.reduce((sum, f) => sum + f.size, 0);
    } catch {
      return 0;
    }
  }

  async grep(pattern: string, options?: { include?: string; maxResults?: number }): Promise<GrepMatch[]> {
    const args = ["-rn"];
    if (options?.include) {
      args.push("--include", options.include);
    }
    args.push(pattern, ".");

    return new Promise((resolve) => {
      const child = spawn("grep", args, { cwd: this.baseDir, shell: false });
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });
      child.on("error", () => {
        resolve([]);
      });
      child.on("close", (code) => {
        if (code === 0 || code === 1) {
          const maxResults = options?.maxResults ?? 50;
          const lines = stdout.split("\n").filter(Boolean).slice(0, maxResults);
          const results: GrepMatch[] = [];
          const re = /^(.+?):(\d+):(.*)$/;
          for (const line of lines) {
            const m = line.match(re);
            if (!m) continue;
            results.push({
              path: m[1]!.replace(/^\.\//, ""),
              line: Number.parseInt(m[2]!, 10) || 0,
              content: m[3]!.slice(0, 200).trim(),
            });
          }
          resolve(results);
        } else {
          resolve([]);
        }
      });
    });
  }

  async listContainers(): Promise<WorkspaceContainerInfo[]> {
    const lines = await WorkspaceManager.dockerCommandRunner([
      "ps",
      "-a",
      "--filter",
      `label=agent-swarm.conversation-id=${this.conversationId}`,
      "--format",
      "{{json .}}",
    ]);
    return lines
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const raw = JSON.parse(line) as Record<string, unknown>;
        return {
          id: String(raw.ID ?? ""),
          name: String(raw.Names ?? ""),
          image: String(raw.Image ?? ""),
          status: String(raw.Status ?? ""),
          ports: String(raw.Ports ?? ""),
        };
      })
      .filter((container) => container.id || container.name);
  }

  removeContainer(containerName: string): void {
    removeDockerContainer(containerName);
  }

  async removeContainers(names: string[]): Promise<number> {
    if (names.length === 0) {
      return 0;
    }
    const containers = await this.listContainers();
    const allowedNames = new Set(containers.map((c) => c.name));
    const toRemove = names.filter((n) => allowedNames.has(n));
    if (toRemove.length === 0) {
      return 0;
    }
    await WorkspaceManager.dockerCommandRunner(["rm", "-f", ...toRemove]);
    return toRemove.length;
  }

  async startContainers(names: string[]): Promise<number> {
    if (names.length === 0) {
      return 0;
    }
    const containers = await this.listContainers();
    const allowedNames = new Set(containers.map((c) => c.name));
    const toStart = names.filter((n) => allowedNames.has(n));
    if (toStart.length === 0) {
      return 0;
    }
    await WorkspaceManager.dockerCommandRunner(["start", ...toStart]);
    return toStart.length;
  }

  async stopContainers(names: string[]): Promise<number> {
    if (names.length === 0) {
      return 0;
    }
    const containers = await this.listContainers();
    const allowedNames = new Set(containers.map((c) => c.name));
    const toStop = names.filter((n) => allowedNames.has(n));
    if (toStop.length === 0) {
      return 0;
    }
    await WorkspaceManager.dockerCommandRunner(["stop", ...toStop]);
    return toStop.length;
  }

  async restartContainers(names: string[]): Promise<number> {
    if (names.length === 0) {
      return 0;
    }
    const containers = await this.listContainers();
    const allowedNames = new Set(containers.map((c) => c.name));
    const toRestart = names.filter((n) => allowedNames.has(n));
    if (toRestart.length === 0) {
      return 0;
    }
    await WorkspaceManager.dockerCommandRunner(["restart", ...toRestart]);
    return toRestart.length;
  }

  async cleanupContainers(): Promise<number> {
    return removeDockerContainersByConversation(this.conversationId);
  }

  async cleanup(): Promise<void> {
    await this.cleanupContainers().catch(() => {
      // Docker may be unavailable; workspace files should still be removed.
    });
    await rm(this.baseDir, { recursive: true, force: true });
  }

  static setDockerCommandRunnerForTest(runner: (args: string[]) => Promise<string>): () => void {
    const previous = WorkspaceManager.dockerCommandRunner;
    WorkspaceManager.dockerCommandRunner = runner;
    return () => {
      WorkspaceManager.dockerCommandRunner = previous;
    };
  }
}

function removeDockerContainer(containerName: string): void {
  const child = spawn("docker", ["rm", "-f", containerName], {
    stdio: "ignore",
    shell: false,
    detached: true,
  });
  child.on("error", () => {
    // Docker may be unavailable; this is best-effort cleanup.
  });
  child.unref();
}

async function removeDockerContainersByConversation(conversationId: string): Promise<number> {
  const ids = await WorkspaceManager.dockerCommandRunner([
    "ps",
    "-aq",
    "--filter",
    `label=agent-swarm.conversation-id=${conversationId}`,
  ]);
  const containers = ids.split(/\s+/).filter(Boolean);
  if (containers.length === 0) {
    return 0;
  }
  await WorkspaceManager.dockerCommandRunner(["rm", "-f", ...containers]);
  return containers.length;
}

function dockerStdout(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr || `docker exited with ${code}`));
    });
  });
}

export function createWorkspaceManager(conversationId: string): WorkspaceManager {
  return new WorkspaceManager(conversationId);
}
