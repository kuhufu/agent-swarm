import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptionsWithoutStdio } from "node:child_process";
import { relative } from "node:path";
import type { WorkspaceManager } from "./manager.js";

const ExecuteFileParams = Type.Object({
  command: Type.String({
    description: "在新的 Docker 容器内执行的 shell 命令。工作区挂载在 /workspace，默认工作目录也是 /workspace。例如: 'node app.js'、'npm test'、'sh script.sh'。不要使用需要交互输入的命令。不要用本工具运行 curl/http.get 去访问另一个后台服务：每次调用都是新容器，默认禁网，容器内 localhost 只指向这个新容器自己，不是已启动的服务容器，也不是宿主机。",
  }),
  timeoutMs: Type.Optional(Type.Number({
    description: "前台执行超时（毫秒），默认 10000，范围 1000-30000。background=true 时不使用该超时，容器会持续运行直到会话停止/删除或用户中止。",
    minimum: 1000,
    maximum: 30000,
  })),
  startupWaitMs: Type.Optional(Type.Number({
    description: "background=true 时的启动确认等待时间（毫秒），默认 2000，范围 500-10000。工具会等待这段时间；如果容器在此期间退出，会返回实际退出码和 stderr，而不是误报后台运行中。",
    minimum: 500,
    maximum: 10000,
  })),
  cwd: Type.Optional(Type.String({
    description: "命令执行的工作子目录（相对于工作区根目录）。默认就是工作区根目录 /workspace。不要填 'workspace' 来表示根目录；只有文件确实位于工作区下的某个子目录时才填写，例如 'src' 会映射为 /workspace/src。",
  })),
  ports: Type.Optional(Type.Array(Type.Object({
    containerPort: Type.Number({
      description: "容器内服务实际监听的端口，必须和应用代码/启动命令中的监听端口一致。例如 app.listen(3000) 就填 3000。不要为了改变浏览器访问端口而修改这个值或修改代码里的监听端口；只改 hostPort。",
      minimum: 1,
      maximum: 65535,
    }),
    hostPort: Type.Optional(Type.Number({
      description: "宿主机 127.0.0.1 上用于访问服务的端口。默认等于 containerPort。想把容器内 3000 映射为本机 5174 时，保持 containerPort=3000，只设置 hostPort=5174；不要改应用代码监听端口。",
      minimum: 1,
      maximum: 65535,
    })),
  }), {
    description: "可选端口映射，仅用于启动服务容器。未设置时容器使用 --network none；设置后会启用 Docker bridge 网络，并绑定到宿主机 127.0.0.1。containerPort 是应用在容器内实际监听的端口，hostPort 是本机访问端口。只想换浏览器/用户访问端口时只改 hostPort，不要改代码。示例: app 监听 3000，但希望用户访问 http://127.0.0.1:5174，则传 [{\"containerPort\":3000,\"hostPort\":5174}]。不要再启动另一个容器用 localhost 访问这个端口。",
    maxItems: 8,
  })),
  background: Type.Optional(Type.Boolean({
    description: "是否后台运行。设置为 true 时，工具启动 Docker 容器后立即返回，不等待命令结束；适合启动 Web 服务或长驻进程。后台进程会在用户停止会话、WebSocket 断开或删除会话时被清理。",
    default: false,
  })),
});

interface ExecuteFileDetails {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  pid?: number;
  containerName: string;
  image: string;
  containerCwd: string;
  ports: PortMapping[];
  background?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
}

interface PortMapping {
  containerPort: number;
  hostPort: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_DOCKER_IMAGE = "node:22-alpine";

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcess;

interface ExecuteFileToolOptions {
  dockerImage?: string;
  spawn?: SpawnFn;
}

export function createExecuteFileTool(
  workspace: WorkspaceManager,
  options: ExecuteFileToolOptions = {},
): AgentTool<typeof ExecuteFileParams, ExecuteFileDetails> {
  const spawn = options.spawn ?? nodeSpawn;
  const dockerImage = options.dockerImage ?? process.env.AGENT_SWARM_WORKSPACE_IMAGE ?? DEFAULT_DOCKER_IMAGE;

  return {
    name: "workspace_execute",
    label: "执行命令",
    description: "在新的 Docker 隔离容器中执行命令。工作区挂载到 /workspace。默认禁用网络；如需启动 Web 服务，使用 ports 显式把容器内监听端口映射到宿主机 127.0.0.1，并设置 background=true。注意：containerPort 必须等于应用代码实际监听端口；如果只是想换浏览器访问端口，只改 hostPort，不要改代码里的监听端口。不要用本工具再启动一个 node/curl 请求去访问后台服务；新容器内的 localhost 不是后台服务容器。启动成功后直接把 http://127.0.0.1:<hostPort> 告诉用户访问。",
    parameters: ExecuteFileParams,
    execute: async (toolCallId, params, signal?: AbortSignal) => {
      await workspace.ensureDir();
      const hostCwd = params.cwd ? workspace.checkPath(params.cwd) : workspace.baseDir;
      const containerCwd = toContainerCwd(workspace.baseDir, hostCwd);
      const containerName = createContainerName(workspace.conversationId, toolCallId);

      const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const command = params.command.trim();
      if (!command) {
        throw new Error("命令不能为空");
      }
      const ports = normalizePorts(params.ports);
      const background = params.background === true;
      const startupWaitMs = normalizeStartupWaitMs(params.startupWaitMs);

      return new Promise<AgentToolResult<ExecuteFileDetails>>((resolve, reject) => {
        const dockerArgs = buildDockerArgs({
          image: dockerImage,
          conversationId: workspace.conversationId,
          toolCallId,
          containerName,
          workspaceDir: workspace.baseDir,
          containerCwd,
          command,
          ports,
        });
        const child = spawn("docker", dockerArgs, {
          cwd: workspace.baseDir,
          env: minimalDockerEnv(),
          shell: false,
          detached: true,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let returnedBackgroundResult = false;
        let aborted = false;
        let timedOut = false;

        const timeout = background ? undefined : setTimeout(() => {
          timedOut = true;
          workspace.removeContainer(containerName);
          killDockerClient(child, "SIGTERM");
        }, timeoutMs);

        const forceKillTimeout = background ? undefined : setTimeout(() => {
          if (!settled && (timedOut || aborted)) {
            killDockerClient(child, "SIGKILL");
          }
        }, timeoutMs + 1000);

        const onAbort = () => {
          aborted = true;
          workspace.removeContainer(containerName);
          killDockerClient(child, "SIGTERM");
          setTimeout(() => {
            if (!settled) {
              killDockerClient(child, "SIGKILL");
            }
          }, 1000);
        };

        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString("utf-8");
        });

        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString("utf-8");
        });

        child.on("error", (err: Error) => {
          if (timeout) clearTimeout(timeout);
          if (forceKillTimeout) clearTimeout(forceKillTimeout);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error(`命令执行失败: ${err.message}`));
        });

        if (background) {
          setTimeout(() => {
            if (settled || returnedBackgroundResult) {
              return;
            }
            returnedBackgroundResult = true;
            signal?.removeEventListener("abort", onAbort);
            resolve({
              content: [{
                type: "text",
                text: [
                  `命令: ${command}`,
                  `镜像: ${dockerImage}`,
                  `容器: ${containerName}`,
                  `会话: ${workspace.conversationId}`,
                  `目录: ${containerCwd}`,
                  ports.length > 0 ? `端口: ${formatPorts(ports)}` : undefined,
                  child.pid ? `docker进程: ${child.pid}` : undefined,
                  "状态: 后台运行中",
                  "stdout/stderr: 后台进程启动后不持续收集输出",
                ].filter(Boolean).join("\n"),
              }],
              details: {
                exitCode: null,
                stdout,
                stderr,
                containerName,
                image: dockerImage,
                containerCwd,
                ports,
                background: true,
                ...(child.pid ? { pid: child.pid } : {}),
                aborted: false,
                timedOut: false,
              },
            });
          }, startupWaitMs);
        }

        child.on("close", (code: number | null, closeSignal: NodeJS.Signals | null) => {
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (forceKillTimeout) clearTimeout(forceKillTimeout);
          signal?.removeEventListener("abort", onAbort);
          const maxOutput = 8000;
          const truncatedStdout = stdout.length > maxOutput
            ? stdout.slice(0, maxOutput) + "\n...(stdout 已截断)"
            : stdout;
          const truncatedStderr = stderr.length > maxOutput
            ? stderr.slice(0, maxOutput) + "\n...(stderr 已截断)"
            : stderr;

          const text = [
            `命令: ${command}`,
            `镜像: ${dockerImage}`,
            `容器: ${containerName}`,
            `会话: ${workspace.conversationId}`,
            `目录: ${containerCwd}`,
            ports.length > 0 ? `端口: ${formatPorts(ports)}` : undefined,
            child.pid ? `docker进程: ${child.pid}` : undefined,
            `退出码: ${code ?? "null"}`,
            closeSignal ? `信号: ${closeSignal}` : undefined,
            timedOut ? "状态: 已超时并终止" : undefined,
            aborted ? "状态: 已取消并终止" : undefined,
            truncatedStdout ? `stdout:\n${truncatedStdout}` : "stdout: (无输出)",
            truncatedStderr ? `stderr:\n${truncatedStderr}` : "stderr: (无输出)",
          ].filter(Boolean).join("\n");

          const dockerInfraError = getDockerInfrastructureError(code, truncatedStderr);
          if (dockerInfraError) {
            if (!returnedBackgroundResult) {
              reject(new Error(dockerInfraError));
            }
            return;
          }

          if (returnedBackgroundResult) {
            return;
          }

          resolve({
            content: [{ type: "text", text }],
            details: {
              exitCode: code,
              stdout: truncatedStdout,
              stderr: truncatedStderr,
              containerName,
              image: dockerImage,
              containerCwd,
              ports,
              background,
              ...(child.pid ? { pid: child.pid } : {}),
              aborted,
              timedOut,
            },
          });
        });
      });
    },
  };
}

function buildDockerArgs(options: {
  image: string;
  conversationId: string;
  toolCallId: string;
  containerName: string;
  workspaceDir: string;
  containerCwd: string;
  command: string;
  ports: PortMapping[];
}): string[] {
  return [
    "run",
    "--rm",
    "--name", options.containerName,
    "--label", "agent-swarm=true",
    "--label", `agent-swarm.conversation-id=${options.conversationId}`,
    "--label", `agent-swarm.tool-call-id=${options.toolCallId}`,
    ...(options.ports.length > 0 ? buildPortArgs(options.ports) : ["--network", "none"]),
    "--cpus", "1",
    "--memory", "256m",
    "--pids-limit", "128",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--user", getContainerUser(),
    "--mount", `type=bind,src=${options.workspaceDir},dst=/workspace`,
    "-w", options.containerCwd,
    options.image,
    "sh",
    "-lc",
    options.command,
  ];
}

function createContainerName(conversationId: string, toolCallId: string): string {
  const raw = `agent-swarm-${conversationId}-${toolCallId}`;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 120)
    .replace(/[-_.]+$/, "");
  return normalized || `agent-swarm-${Date.now()}`;
}

function buildPortArgs(ports: PortMapping[]): string[] {
  return ports.flatMap((port) => [
    "-p",
    `127.0.0.1:${port.hostPort}:${port.containerPort}`,
  ]);
}

function normalizePorts(input: unknown): PortMapping[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const ports: PortMapping[] = [];
  const seenHostPorts = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("ports 必须是 { containerPort, hostPort? } 数组");
    }
    const item = raw as { containerPort?: unknown; hostPort?: unknown };
    const containerPort = normalizePortNumber(item.containerPort, "containerPort");
    const hostPort = item.hostPort === undefined
      ? containerPort
      : normalizePortNumber(item.hostPort, "hostPort");
    if (seenHostPorts.has(hostPort)) {
      throw new Error(`hostPort 重复: ${hostPort}`);
    }
    seenHostPorts.add(hostPort);
    ports.push({ containerPort, hostPort });
  }
  return ports;
}

function normalizePortNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${field} 必须是 1-65535 的整数`);
  }
  return value;
}

function normalizeStartupWaitMs(value: unknown): number {
  if (value === undefined) {
    return 2000;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 500 || value > 10000) {
    throw new Error("startupWaitMs 必须是 500-10000 的整数");
  }
  return value;
}

function formatPorts(ports: PortMapping[]): string {
  return ports
    .map((port) => `127.0.0.1:${port.hostPort}->${port.containerPort}`)
    .join(", ");
}

function toContainerCwd(workspaceDir: string, hostCwd: string): string {
  const rel = relative(workspaceDir, hostCwd);
  if (!rel || rel === ".") {
    return "/workspace";
  }
  return `/workspace/${rel.split(/[\\/]+/).filter(Boolean).join("/")}`;
}

function getContainerUser(): string {
  const getUid = process.getuid;
  const getGid = process.getgid;
  if (typeof getUid === "function" && typeof getGid === "function") {
    return `${getUid()}:${getGid()}`;
  }
  return "1000:1000";
}

function minimalDockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function getDockerInfrastructureError(exitCode: number | null, stderr: string): string | null {
  if (exitCode !== 125) {
    return null;
  }
  if (/Cannot connect to the Docker daemon/i.test(stderr)) {
    return "Docker daemon 未运行或当前进程无法连接 Docker socket。请先启动 Docker Desktop / Docker 服务后再执行 workspace 命令。";
  }
  if (/command not found|executable file not found|no such file or directory/i.test(stderr) && /docker/i.test(stderr)) {
    return "未找到 Docker CLI。workspace_execute 需要本机安装 Docker 并确保 docker 命令在 PATH 中。";
  }
  return null;
}

function killDockerClient(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.killed) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // Fall through to killing the direct docker client process.
  }
  try {
    child.kill(signal);
  } catch {
    // Process may have already exited.
  }
}
