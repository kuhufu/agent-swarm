export interface FrontendJsExecutionResult {
  logs: string[];
  result: string;
  isError: boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`执行超时（>${timeoutMs}ms）`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(value);
      },
      (error) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(error);
      },
    );
  });
}

export async function executeJavascriptInFrontend(
  code: string,
  timeoutMs = 1500,
): Promise<FrontendJsExecutionResult> {
  const logs: string[] = [];
  const consoleProxy = {
    log: (...args: unknown[]) => logs.push(args.map((arg) => formatValue(arg)).join(" ")),
    info: (...args: unknown[]) => logs.push(args.map((arg) => formatValue(arg)).join(" ")),
    warn: (...args: unknown[]) => logs.push(args.map((arg) => formatValue(arg)).join(" ")),
    error: (...args: unknown[]) => logs.push(args.map((arg) => formatValue(arg)).join(" ")),
  };

  try {
    const executor = new Function("console", `"use strict";\n${code}`);
    const raw = executor(consoleProxy) as unknown;
    const output = raw instanceof Promise
      ? await withTimeout(raw, timeoutMs)
      : raw;
    const outputText = formatValue(output);
    const normalizedResult = output === undefined && logs.length > 0
      ? logs[logs.length - 1]
      : outputText;

    return {
      logs,
      result: normalizedResult ?? "undefined",
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      logs,
      result: message,
      isError: true,
    };
  }
}
