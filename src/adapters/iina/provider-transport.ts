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
  nativeDirectory: string,
  helper: "transport" | "extractor",
): {
  requestFile: string;
  responseFile: string;
  nativeRequestFile: string;
  nativeResponseFile: string;
} {
  const stem = [
    helper,
    Date.now().toString(36),
    (++rpcSequence).toString(36),
    Math.random().toString(36).slice(2, 14),
  ].join("-");
  return {
    requestFile: `${fileDirectory}/${stem}.request.json`,
    responseFile: `${fileDirectory}/${stem}.response.json`,
    nativeRequestFile: `${nativeDirectory}/${stem}.request.json`,
    nativeResponseFile: `${nativeDirectory}/${stem}.response.json`,
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
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly launcher: ProcessLauncher,
    private readonly files: RpcFileStore,
    private readonly executable: string,
    private readonly options: {
      helper: "transport" | "extractor";
      fileDirectory: string;
      nativeDirectory: string;
      maxRequestBytes: number;
      maxResponseBytes: number;
      maxConcurrentRequests: number;
    },
  ) {
    if (
      !Number.isInteger(options.maxConcurrentRequests) ||
      options.maxConcurrentRequests < 1 ||
      options.maxConcurrentRequests > 32
    )
      throw new Error("HELPER_RPC_CONCURRENCY_INVALID");
  }

  async post<T>(port: number, bearerToken: string, path: string, body: unknown): Promise<T> {
    await this.acquire();
    try {
      return await this.execute<T>(port, bearerToken, path, body);
    } finally {
      this.release();
    }
  }

  private async execute<T>(
    port: number,
    bearerToken: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const paths = privateRpcPaths(
      this.options.fileDirectory.replace(/\/+$/, ""),
      this.options.nativeDirectory.replace(/\/+$/, ""),
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
    if (this.files.exists(paths.requestFile) || this.files.exists(paths.responseFile))
      throw new Error("HELPER_RPC_FILE_CONFLICT");
    try {
      this.files.write(paths.requestFile, request);
      let exitStatus: number | null = null;
      const completion = this.launcher.launch(this.executable, [
        "--rpc-client",
        "--rpc-directory",
        this.options.nativeDirectory,
        "--request-file",
        paths.nativeRequestFile,
        "--response-file",
        paths.nativeResponseFile,
      ]);
      void completion.then(
        (result) => {
          exitStatus = result.status;
        },
        () => {
          exitStatus = -1;
        },
      );
      const deadline = Date.now() + rpcResponseTimeoutMs[this.options.helper];
      while (!this.files.exists(paths.responseFile)) {
        if (exitStatus !== null)
          throw new Error(
            exitStatus === 0 ? "HELPER_RPC_MISSING_RESPONSE" : "HELPER_RPC_FAILED",
          );
        if (Date.now() >= deadline) throw new Error("HELPER_RPC_TIMEOUT");
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      const response = this.files.read(paths.responseFile);
      if (response === null) throw new Error("HELPER_RPC_MISSING_RESPONSE");
      const frame = parseFileRpcFrame(response, startedAtMs, this.options.maxResponseBytes);
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
      return frame.body as T;
    } finally {
      removeRpcFile(this.files, paths.requestFile);
      removeRpcFile(this.files, paths.responseFile);
    }
  }

  private acquire(): Promise<void> {
    if (this.activeRequests < this.options.maxConcurrentRequests) {
      this.activeRequests += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeRequests -= 1;
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
