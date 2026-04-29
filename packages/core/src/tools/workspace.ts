import { mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";

const WORKSPACE_ROOT = join(tmpdir(), "agent-workspaces");
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_WORKSPACE_SIZE = 52_428_800; // 50MB
const MAX_READ_SIZE = 10240; // 10KB

export interface FileInfo {
  path: string;
  size: number;
}

export class WorkspaceManager {
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

  async cleanup(): Promise<void> {
    await rm(this.baseDir, { recursive: true, force: true });
  }
}

export function createWorkspaceManager(conversationId: string): WorkspaceManager {
  return new WorkspaceManager(conversationId);
}
