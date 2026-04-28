import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

// ── Types ──

export type MCPTransport = "stdio" | "sse";

export interface MCPServerConfig {
  id: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: string | number;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export type MCPServerStatus = "disconnected" | "connecting" | "connected" | "error";

// ── Stdio Transport ──

class StdioTransport {
  private process: ChildProcess | null = null;
  private messageHandlers: Array<(msg: JSONRPCMessage) => void> = [];
  private lineHandler: ((line: string) => void) | null = null;

  async start(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    const rl = createInterface({ input: this.process.stdout! });
    this.lineHandler = (line: string) => {
      try {
        const msg = JSON.parse(line) as JSONRPCMessage;
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch {
        // skip non-JSON lines (e.g. server startup logs)
      }
    };
    rl.on("line", this.lineHandler);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.process?.stdin) throw new Error("MCP transport not connected");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  close(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    this.messageHandlers = [];
  }
}

// ── SSE Transport ──

class SSETransport {
  private controller: AbortController | null = null;
  private messageHandlers: Array<(msg: JSONRPCMessage) => void> = [];
  private baseUrl: string;

  constructor(url: string) {
    this.baseUrl = url;
  }

  async start(_headers?: Record<string, string>): Promise<void> {
    this.controller = new AbortController();
    const url = this.baseUrl.endsWith("/sse") ? this.baseUrl : this.baseUrl + "/sse";

    const response = await fetch(url, {
      signal: this.controller.signal,
      headers: { Accept: "text/event-stream" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    // Background read loop (non-blocking)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const msg = JSON.parse(line.slice(6)) as JSONRPCMessage;
                for (const handler of this.messageHandlers) {
                  handler(msg);
                }
              } catch {
                // skip non-JSON data
              }
            }
          }
        }
      } catch {
        // Reader closed or aborted
      }
    })();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!resp.ok) {
      throw new Error(`MCP SSE send failed: ${resp.status}`);
    }
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.messageHandlers = [];
  }
}

// ── MCP Client ──

interface ServerConnection {
  config: MCPServerConfig;
  transport: StdioTransport | SSETransport;
  status: MCPServerStatus;
  tools: MCPTool[];
  pendingRequests: Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  messageId: number;
}

export class MCPClient extends EventEmitter {
  private servers = new Map<string, ServerConnection>();

  async connect(serverId: string, config: MCPServerConfig): Promise<void> {
    if (this.servers.has(serverId)) {
      await this.disconnect(serverId);
    }

    const connection: ServerConnection = {
      config,
      transport: config.transport === "sse" ? new SSETransport(config.url!) : new StdioTransport(),
      status: "connecting",
      tools: [],
      pendingRequests: new Map(),
      messageId: 1,
    };

    this.servers.set(serverId, connection);

    connection.transport.onMessage(async (msg) => {
      if ("id" in msg && "result" in msg && msg.id !== undefined) {
        const pending = connection.pendingRequests.get(msg.id);
        if (pending) {
          msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
          connection.pendingRequests.delete(msg.id);
        }
      }
      if ("method" in msg && msg.method === "tools/list/changed") {
        await this.refreshTools(serverId);
      }
    });

    try {
      if (config.transport === "stdio") {
        await (connection.transport as StdioTransport).start(config.command!, config.args ?? [], config.env);
      } else {
        await (connection.transport as SSETransport).start(config.headers);
      }

      // Initialize handshake
      await this.sendRequest(serverId, {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "agent-swarm", version: "0.1.0" },
        },
        id: connection.messageId++,
      });

      await this.sendNotification(serverId, { jsonrpc: "2.0", method: "initialized" });
      await this.refreshTools(serverId);

      connection.status = "connected";
      this.emit("connected", serverId);
    } catch (err) {
      connection.status = "error";
      this.emit("error", serverId, err);
      throw err;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.servers.get(serverId);
    if (!conn) return;
    conn.transport.close();
    this.servers.delete(serverId);
    this.emit("disconnected", serverId);
  }

  async listTools(serverId: string): Promise<MCPTool[]> {
    const conn = this.servers.get(serverId);
    if (!conn) throw new Error(`MCP server not connected: ${serverId}`);
    if (conn.tools.length > 0) return conn.tools;
    return this.refreshTools(serverId);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: Array<{ type: string; text?: string; data?: string }> }> {
    const conn = this.servers.get(serverId);
    if (!conn) throw new Error(`MCP server not connected: ${serverId}`);

    return this.sendRequest(serverId, {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: conn.messageId++,
    }, signal) as Promise<{ content: Array<{ type: string; text?: string; data?: string }> }>;
  }

  getServerStatus(serverId: string): MCPServerStatus {
    return this.servers.get(serverId)?.status ?? "disconnected";
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([, c]) => c.status === "connected")
      .map(([id]) => id);
  }

  getServerConfig(serverId: string): MCPServerConfig | undefined {
    return this.servers.get(serverId)?.config;
  }

  getAllTools(): Array<{ serverId: string; tool: MCPTool }> {
    const all: Array<{ serverId: string; tool: MCPTool }> = [];
    for (const [serverId, conn] of this.servers) {
      if (conn.status === "connected") {
        for (const tool of conn.tools) {
          all.push({ serverId, tool });
        }
      }
    }
    return all;
  }

  private async refreshTools(serverId: string): Promise<MCPTool[]> {
    const result = await this.sendRequest(serverId, {
      jsonrpc: "2.0",
      method: "tools/list",
      id: this.servers.get(serverId)!.messageId++,
    });
    const tools = (result as { tools: MCPTool[] }).tools ?? [];
    this.servers.get(serverId)!.tools = tools;
    return tools;
  }

  private async sendRequest(serverId: string, request: JSONRPCRequest, signal?: AbortSignal): Promise<unknown> {
    const conn = this.servers.get(serverId);
    if (!conn) throw new Error(`MCP server not found: ${serverId}`);

    return new Promise<unknown>((resolve, reject) => {
      conn.pendingRequests.set(request.id, { resolve, reject });
      conn.transport.send(request).catch((err) => {
        conn.pendingRequests.delete(request.id);
        reject(err);
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          conn.pendingRequests.delete(request.id);
          reject(new Error("MCP call aborted"));
        });
      }

      setTimeout(() => {
        if (conn.pendingRequests.has(request.id)) {
          conn.pendingRequests.delete(request.id);
          reject(new Error("MCP call timeout"));
        }
      }, 30_000);
    });
  }

  private async sendNotification(serverId: string, notification: JSONRPCNotification): Promise<void> {
    const conn = this.servers.get(serverId);
    if (!conn) return;
    await conn.transport.send(notification);
  }
}
