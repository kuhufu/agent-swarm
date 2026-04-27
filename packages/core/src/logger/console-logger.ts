import type { Logger, LogLevel } from "./types.js";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export class ConsoleLogger implements Logger {
  private level: LogLevel;

  constructor(level?: LogLevel) {
    const envLevel = typeof process !== "undefined" ? (process.env as Record<string, string>)["LOG_LEVEL"] : undefined;
    this.level = level ?? (envLevel as LogLevel) ?? "info";
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS.indexOf(level) >= LEVELS.indexOf(this.level);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    const fmt = typeof process !== "undefined" ? (process.env as Record<string, string>)["LOG_FORMAT"] : undefined;
    if (fmt === "pretty") {
      const prefix = `[${entry.timestamp}] ${level.toUpperCase()}`;
      const line = meta && Object.keys(meta).length > 0
        ? `${prefix} ${message} ${JSON.stringify(meta)}`
        : `${prefix} ${message}`;
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    } else {
      const line = JSON.stringify(entry);
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void { this.write("debug", message, meta); }
  info(message: string, meta?: Record<string, unknown>): void { this.write("info", message, meta); }
  warn(message: string, meta?: Record<string, unknown>): void { this.write("warn", message, meta); }
  error(message: string, meta?: Record<string, unknown>): void { this.write("error", message, meta); }

  child(bindings: Record<string, unknown>): Logger {
    return new ChildLogger(this, bindings);
  }
}

class ChildLogger implements Logger {
  constructor(
    private parent: Logger,
    private bindings: Record<string, unknown>,
  ) {}

  debug(message: string, meta?: Record<string, unknown>): void { this.parent.debug(message, { ...this.bindings, ...meta }); }
  info(message: string, meta?: Record<string, unknown>): void { this.parent.info(message, { ...this.bindings, ...meta }); }
  warn(message: string, meta?: Record<string, unknown>): void { this.parent.warn(message, { ...this.bindings, ...meta }); }
  error(message: string, meta?: Record<string, unknown>): void { this.parent.error(message, { ...this.bindings, ...meta }); }
  child(bindings: Record<string, unknown>): Logger { return new ChildLogger(this, bindings); }
}
