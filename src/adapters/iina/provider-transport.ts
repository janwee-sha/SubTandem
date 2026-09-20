import {
  LocalRpcResponseError,
  type LocalRpcBridge,
  type TransportRpcClient,
} from "../../transport/client.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../providers/transport.js";
import { hostTimers, type HostInterval, type HostTimers } from "./host-timers.js";
import type { ProcessLauncher, ReadyFileStore } from "./transport-process.js";

export interface RpcFileStore {
  exists(path: string): boolean;
  write(path: string, content: string): void;
  read(path: string): string | null;
  delete(path: string): void;
}

interface FileRpcFrame {
  type: "response";
  protocolVersion: 1;
  createdAtMs: number;
  statusCode: number;
  body: unknown;
}

interface PendingFileRpc {
  paths: ReturnType<typeof privateRpcPaths>;
  startedAtMs: number;
  deadlineMs: number;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

interface FileRpcWaiter {
  resolve(): void;
  reject(error: unknown): void;
}

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

let rpcSequence = 0;

const rpcResponseTimeoutMs = {
  transport: 130_000,
  extractor: 25_000,
} as const;

function privateRpcPaths(
  fileDirectory: string,
  helper: "transport" | "extractor",
): {
  requestFile: string;
  requestReadyFile: string;
  responseFile: string;
  processingFile: string;
} {
  const stem = [
    helper,
    Date.now().toString(36),
    (++rpcSequence).toString(36),
    Math.random().toString(36).slice(2, 14),
  ].join("-");
  return {
    requestFile: `${fileDirectory}/${stem}.request.json`,
    requestReadyFile: `${fileDirectory}/${stem}.request.ready`,
    responseFile: `${fileDirectory}/${stem}.response.json`,
    processingFile: `${fileDirectory}/${stem}.processing.json`,
  };
}

function parseFileRpcFrame(
  value: string,
  startedAtMs: number,
  maxResponseBytes: number,
): FileRpcFrame {
  if (utf8Length(value) > maxResponseBytes) throw new Error("HELPER_RPC_MALFORMED");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("HELPER_RPC_MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("HELPER_RPC_MALFORMED");
  const frame = parsed as Record<string, unknown>;
  if (
    Object.keys(frame).sort().join(",") !== "body,createdAtMs,protocolVersion,statusCode,type" ||
    frame.type !== "response" ||
    frame.protocolVersion !== 1 ||
    !Number.isInteger(frame.createdAtMs) ||
    (frame.createdAtMs as number) < startedAtMs - 1_000 ||
    (frame.createdAtMs as number) > Date.now() + 1_000 ||
    !Number.isInteger(frame.statusCode) ||
    (frame.statusCode as number) < 100 ||
    (frame.statusCode as number) > 599
  )
    throw new Error("HELPER_RPC_MALFORMED");
  return frame as unknown as FileRpcFrame;
}

function removeRpcFile(files: RpcFileStore, path: string): void {
  try {
    if (files.exists(path)) files.delete(path);
  } catch {
    return;
  }
}

export class IinaFileRpcBridge implements LocalRpcBridge {
  private activeRequests = 0;
  private readonly waiters: FileRpcWaiter[] = [];
  private readonly pending = new Map<string, PendingFileRpc>();
  private poller: HostInterval | null = null;
  private closed = false;
  private readonly timers: Pick<HostTimers, "setInterval">;

  constructor(
    private readonly files: RpcFileStore,
    private readonly options: {
      helper: "transport" | "extractor";
      fileDirectory: string;
      maxRequestBytes: number;
      maxResponseBytes: number;
      maxConcurrentRequests: number;
      timers?: Pick<HostTimers, "setInterval">;
    },
  ) {
    if (
      !Number.isInteger(options.maxConcurrentRequests) ||
      options.maxConcurrentRequests < 1 ||
      options.maxConcurrentRequests > 32
    )
      throw new Error("HELPER_RPC_CONCURRENCY_INVALID");
    this.timers = options.timers ?? hostTimers;
  }

  async post<T>(
    port: number,
    bearerToken: string,
    path: string,
    body: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    await this.acquire();
    try {
      if (this.closed) throw new Error("HELPER_RPC_CLOSED");
      return await this.execute<T>(port, bearerToken, path, body, options?.timeoutMs);
    } finally {
      this.release();
    }
  }

  private async execute<T>(
    port: number,
    bearerToken: string,
    path: string,
    body: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const paths = privateRpcPaths(
      this.options.fileDirectory.replace(/\/+$/, ""),
      this.options.helper,
    );
    const startedAtMs = Date.now();
    const request = JSON.stringify({
      type: "request",
      protocolVersion: 1,
      createdAtMs: startedAtMs,
      port,
      token: bearerToken,
      path,
      body,
    });
    if (utf8Length(request) > this.options.maxRequestBytes)
      throw new Error("HELPER_RPC_REQUEST_TOO_LARGE");
    if (
      this.files.exists(paths.requestFile) ||
      this.files.exists(paths.requestReadyFile) ||
      this.files.exists(paths.processingFile) ||
      this.files.exists(paths.responseFile)
    )
      throw new Error("HELPER_RPC_FILE_CONFLICT");
    return new Promise<T>((resolve, reject) => {
      try {
        this.files.write(paths.requestFile, request);
        this.pending.set(paths.responseFile, {
          paths,
          startedAtMs,
          deadlineMs:
            Date.now() +
            (Number.isFinite(timeoutMs) && Number(timeoutMs) >= 50
              ? Number(timeoutMs)
              : rpcResponseTimeoutMs[this.options.helper]),
          resolve: (value) => resolve(value as T),
          reject,
        });
        this.files.write(paths.requestReadyFile, "");
        this.pollPending();
      } catch (error) {
        this.pending.delete(paths.responseFile);
        this.removeFiles(paths);
        reject(error);
      }
    });
  }

  private pollPending(): void {
    for (const pending of [...this.pending.values()].slice(0, this.options.maxConcurrentRequests)) {
      try {
        if (this.files.exists(pending.paths.responseFile)) {
          const response = this.files.read(pending.paths.responseFile);
          if (response === null) throw new Error("HELPER_RPC_MISSING_RESPONSE");
          const frame = parseFileRpcFrame(
            response,
            pending.startedAtMs,
            this.options.maxResponseBytes,
          );
          if (frame.statusCode < 200 || frame.statusCode >= 300) {
            const error =
              frame.body && typeof frame.body === "object" && !Array.isArray(frame.body)
                ? (frame.body as Record<string, unknown>).error
                : undefined;
            throw new LocalRpcResponseError(
              typeof error === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(error)
                ? error
                : "helper-rpc-failed",
            );
          }
          this.settle(pending, frame.body);
        } else if (Date.now() >= pending.deadlineMs) {
          throw new Error("HELPER_RPC_TIMEOUT");
        }
      } catch (error) {
        this.settle(pending, undefined, error);
      }
    }
    if (this.pending.size === 0 && this.waiters.length === 0) {
      this.poller?.cancel();
      this.poller = null;
    } else if (this.pending.size > 0 && this.poller === null) {
      this.poller = this.timers.setInterval(() => this.pollPending(), 20);
    }
  }

  private settle(pending: PendingFileRpc, value: unknown, error?: unknown): void {
    if (!this.pending.delete(pending.paths.responseFile)) return;
    this.removeFiles(pending.paths);
    if (error === undefined) pending.resolve(value);
    else pending.reject(error);
  }

  private removeFiles(paths: ReturnType<typeof privateRpcPaths>): void {
    removeRpcFile(this.files, paths.requestFile);
    removeRpcFile(this.files, paths.requestReadyFile);
    removeRpcFile(this.files, paths.processingFile);
    removeRpcFile(this.files, paths.responseFile);
  }

  private acquire(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("HELPER_RPC_CLOSED"));
    if (this.activeRequests < this.options.maxConcurrentRequests) {
      this.activeRequests += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.activeRequests -= 1;
  }

  close(error: unknown = new Error("HELPER_RPC_CLOSED")): void {
    if (this.closed) return;
    this.closed = true;
    this.poller?.cancel();
    this.poller = null;
    for (const pending of [...this.pending.values()]) this.settle(pending, undefined, error);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

export class IinaProcessLauncher implements ProcessLauncher {
  constructor(private readonly utils: IINA.API.Utils) {}

  launch(executable: string, args: string[]): Promise<{ status: number }> {
    return this.utils.exec(executable, args);
  }
}

export class IinaReadyFileStore implements ReadyFileStore {
  constructor(private readonly file: IINA.API.File) {}

  exists(path: string): boolean {
    return this.file.exists(path);
  }

  read(path: string): string | null {
    return this.file.read(path) ?? null;
  }

  write(path: string, content: string): void {
    this.file.write(path, content);
  }

  delete(path: string): void {
    this.file.delete(path);
  }

  list(path: string): Array<{ filename: string; isDir: boolean }> {
    return this.file.list(path, { includeSubDir: false });
  }
}

export class HelperProviderTransport implements ProviderTransport {
  private readonly helperJobs = new Map<string, string>();

  constructor(
    private readonly client: TransportRpcClient,
    private readonly createHelperJobId: () => string,
  ) {}

  async request(request: ProviderTransportRequest): Promise<ProviderTransportResponse> {
    const helperJobId = this.createHelperJobId();
    this.helperJobs.set(request.jobId, helperJobId);
    try {
      const response = await this.client.request({ ...request, jobId: helperJobId });
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        bodyText: response.bodyText,
      };
    } finally {
      if (this.helperJobs.get(request.jobId) === helperJobId) this.helperJobs.delete(request.jobId);
    }
  }

  async cancel(jobId: string): Promise<void> {
    const helperJobId = this.helperJobs.get(jobId);
    if (helperJobId) await this.client.cancel(helperJobId);
  }
}
