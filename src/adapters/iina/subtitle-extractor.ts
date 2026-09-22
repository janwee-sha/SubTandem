import type { EmbeddedSubtitleCodec, ExtractedSubtitleResult } from "../../subtitles/types.js";
import { LocalRpcResponseError, type LocalRpcBridge } from "../../transport/client.js";
import {
  createReadyFilePath,
  createRpcSessionId,
  removeStaleHelperFiles,
  type HelperExecutableLocator,
  type ProcessLauncher,
  type ReadyFileStore,
  type ReadyFrame,
} from "./transport-process.js";
import { hostTimers } from "./host-timers.js";

export type SubtitleExtractorRpcBridge = LocalRpcBridge;

export interface SubtitleExtractorSession {
  port: number;
  token: string;
}

export interface SubtitleExtractorProcessSession extends SubtitleExtractorSession {
  rpcSessionId: string;
  rpcDirectory: string;
  resultDirectory: string;
}

export interface SubtitlePrepareRequest {
  jobId: string;
  mediaPath: string;
  stream: {
    ffIndex: number;
    sourceId: number | null;
    codec: EmbeddedSubtitleCodec;
  };
  deadlineMs: number;
  maxCueCount: number;
  maxOutputBytes: number;
}

export type SubtitleExtractorErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_CODEC"
  | "TRACK_IDENTITY_MISMATCH"
  | "EMPTY_OR_UNREADABLE"
  | "OUTPUT_LIMIT"
  | "TIMED_OUT"
  | "CANCELLED"
  | "EXTRACTION_FAILED"
  | "EXTRACTOR_UNAVAILABLE"
  | "EXTRACTOR_PROTOCOL";

export class SubtitleExtractorError extends Error {
  constructor(readonly code: SubtitleExtractorErrorCode) {
    super(code);
    this.name = "SubtitleExtractorError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(","))
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  return record;
}

export function parseSubtitleExtractorReadyFrame(
  output: string,
  notBeforeMs = 0,
  nowMs = Date.now(),
): ReadyFrame {
  if (output.length > 2_048) throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  if (output.split("\n").filter(Boolean).length !== 1)
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  }
  const frame = exactObject(value, ["type", "port", "token", "protocolVersion", "createdAtMs"]);
  if (
    frame.type !== "ready" ||
    frame.protocolVersion !== 1 ||
    !Number.isInteger(frame.port) ||
    (frame.port as number) < 1024 ||
    (frame.port as number) > 65535 ||
    typeof frame.token !== "string" ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(frame.token) ||
    !Number.isInteger(frame.createdAtMs) ||
    (frame.createdAtMs as number) < notBeforeMs - 1_000 ||
    (frame.createdAtMs as number) > nowMs + 1_000
  )
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  return frame as unknown as ReadyFrame;
}

function validatePrepareRequest(request: SubtitlePrepareRequest): void {
  if (
    !uuidPattern.test(request.jobId) ||
    !request.mediaPath.startsWith("/") ||
    request.mediaPath.includes("\0") ||
    !Number.isInteger(request.stream.ffIndex) ||
    request.stream.ffIndex < 0 ||
    (request.stream.sourceId !== null && !Number.isInteger(request.stream.sourceId)) ||
    !["subrip", "ass", "ssa", "mov_text"].includes(request.stream.codec) ||
    request.deadlineMs !== 15_000 ||
    request.maxCueCount !== 20_000 ||
    request.maxOutputBytes !== 16_777_216
  )
    throw new SubtitleExtractorError("INVALID_REQUEST");
}

function validateResult(value: unknown, request: SubtitlePrepareRequest): ExtractedSubtitleResult {
  const result = exactObject(value, [
    "jobId",
    "state",
    "resultId",
    "format",
    "cueCount",
    "byteCount",
    "sha256",
  ]);
  if (
    result.jobId !== request.jobId ||
    result.state !== "ready" ||
    result.resultId !== request.jobId ||
    result.format !== "srt" ||
    !Number.isInteger(result.cueCount) ||
    (result.cueCount as number) < 1 ||
    (result.cueCount as number) > request.maxCueCount ||
    !Number.isInteger(result.byteCount) ||
    (result.byteCount as number) < 1 ||
    (result.byteCount as number) > request.maxOutputBytes ||
    typeof result.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(result.sha256)
  )
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  return result as unknown as ExtractedSubtitleResult;
}

export interface SubtitleExtractorRpcClient {
  prepare(
    request: SubtitlePrepareRequest,
    canReplay?: () => boolean,
  ): Promise<ExtractedSubtitleResult>;
  cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown">;
  release(resultId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ManagedSubtitleExtractorRpcClient extends SubtitleExtractorRpcClient {
  health(): Promise<void>;
  dispose(): void;
}

const extractorControlTimeoutMs = 1_000;
const extractorPrepareTimeoutMs = 25_000;

export class SubtitleExtractorClient implements ManagedSubtitleExtractorRpcClient {
  private shutdownRequest: Promise<void> | null = null;

  constructor(
    private readonly session: SubtitleExtractorSession,
    private readonly bridge: SubtitleExtractorRpcBridge,
  ) {
    if (
      !Number.isInteger(session.port) ||
      session.port < 1024 ||
      session.port > 65535 ||
      !/^[A-Za-z0-9_-]{8,512}$/.test(session.token)
    )
      throw new SubtitleExtractorError("INVALID_REQUEST");
  }

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs = extractorControlTimeoutMs,
  ): Promise<T> {
    try {
      return await this.bridge.post<T>(this.session.port, this.session.token, path, body, {
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof SubtitleExtractorError) throw error;
      if (
        error instanceof LocalRpcResponseError &&
        [
          "INVALID_REQUEST",
          "UNSUPPORTED_CODEC",
          "TRACK_IDENTITY_MISMATCH",
          "EMPTY_OR_UNREADABLE",
          "OUTPUT_LIMIT",
          "TIMED_OUT",
          "CANCELLED",
          "EXTRACTION_FAILED",
        ].includes(error.code)
      )
        throw new SubtitleExtractorError(error.code as SubtitleExtractorErrorCode);
      throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    }
  }

  async health(): Promise<void> {
    const response = exactObject(await this.post("/v1/health", {}), ["state"]);
    if (response.state !== "ok") throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  }

  async prepare(request: SubtitlePrepareRequest): Promise<ExtractedSubtitleResult> {
    validatePrepareRequest(request);
    return validateResult(
      await this.post("/v1/prepare", request, extractorPrepareTimeoutMs),
      request,
    );
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    if (!uuidPattern.test(jobId)) throw new SubtitleExtractorError("INVALID_REQUEST");
    const response = exactObject(await this.post("/v1/cancel", { jobId }), ["state"]);
    if (!["cancelled", "already-completed", "unknown"].includes(String(response.state)))
      throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
    return response.state as "cancelled" | "already-completed" | "unknown";
  }

  async release(resultId: string): Promise<void> {
    if (!uuidPattern.test(resultId)) throw new SubtitleExtractorError("INVALID_REQUEST");
    const response = exactObject(await this.post("/v1/release", { resultId }), ["state"]);
    if (response.state !== "released") throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  }

  shutdown(): Promise<void> {
    if (this.shutdownRequest) return this.shutdownRequest;
    this.shutdownRequest = this.requestShutdown();
    return this.shutdownRequest;
  }

  private async requestShutdown(): Promise<void> {
    try {
      const response = exactObject(await this.post("/v1/shutdown", {}), ["state"]);
      if (response.state !== "shutting-down")
        throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
    } finally {
      this.dispose();
    }
  }

  dispose(): void {
    this.bridge.close?.();
  }
}

function isUnavailableExtractor(error: unknown): boolean {
  return error instanceof SubtitleExtractorError && error.code === "EXTRACTOR_UNAVAILABLE";
}

export class SubtitleExtractorSupervisor implements SubtitleExtractorRpcClient {
  private client: ManagedSubtitleExtractorRpcClient | null = null;
  private starting: Promise<ManagedSubtitleExtractorRpcClient> | null = null;
  private checking: Promise<ManagedSubtitleExtractorRpcClient> | null = null;
  private readonly pendingPrepares = new Map<
    string,
    { submitted: Promise<void>; markSubmitted: () => void }
  >();

  constructor(private readonly start: () => Promise<ManagedSubtitleExtractorRpcClient>) {}

  private async currentOrStart(): Promise<ManagedSubtitleExtractorRpcClient> {
    if (this.client) return this.client;
    if (!this.starting) this.starting = this.start();
    const starting = this.starting;
    try {
      const client = await starting;
      if (this.starting === starting) {
        this.client = client;
        this.starting = null;
      }
      return client;
    } catch (error) {
      if (this.starting === starting) this.starting = null;
      throw error;
    }
  }

  private retire(client: ManagedSubtitleExtractorRpcClient): void {
    if (this.client !== client) return;
    this.client = null;
    client.dispose();
  }

  private async liveClient(): Promise<ManagedSubtitleExtractorRpcClient> {
    if (this.checking) return this.checking;
    const checking = (async () => {
      let client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        if (!isUnavailableExtractor(error)) throw error;
        this.retire(client);
      }
      client = await this.currentOrStart();
      try {
        await client.health();
        return client;
      } catch (error) {
        this.retire(client);
        throw error;
      }
    })();
    this.checking = checking;
    try {
      return await checking;
    } finally {
      if (this.checking === checking) this.checking = null;
    }
  }

  async health(): Promise<void> {
    await this.liveClient();
  }

  async prepare(
    request: SubtitlePrepareRequest,
    canReplay?: () => boolean,
  ): Promise<ExtractedSubtitleResult> {
    let markSubmitted!: () => void;
    let submitted = false;
    const submittedPromise = new Promise<void>((resolve) => {
      markSubmitted = () => {
        if (submitted) return;
        submitted = true;
        resolve();
      };
    });
    const pending = { submitted: submittedPromise, markSubmitted };
    this.pendingPrepares.set(request.jobId, pending);
    const invoke = (client: ManagedSubtitleExtractorRpcClient) => {
      const outcome = client.prepare(request);
      markSubmitted();
      return outcome;
    };
    try {
      let client = await this.liveClient();
      try {
        return await invoke(client);
      } catch (error) {
        if (!isUnavailableExtractor(error)) throw error;
        this.retire(client);
        if (!canReplay?.()) throw error;
      }
      client = await this.liveClient();
      if (!canReplay?.()) throw new SubtitleExtractorError("CANCELLED");
      return await invoke(client);
    } finally {
      markSubmitted();
      if (this.pendingPrepares.get(request.jobId) === pending)
        this.pendingPrepares.delete(request.jobId);
    }
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    await this.pendingPrepares.get(jobId)?.submitted;
    let client = this.client;
    if (!client && this.starting) {
      try {
        client = await this.starting;
      } catch {
        return "unknown";
      }
    }
    if (!client) return "unknown";
    let retryUntil = 0;
    while (true) {
      try {
        const state = await client.cancel(jobId);
        if (state !== "unknown" || !this.pendingPrepares.has(jobId)) return state;
        if (retryUntil === 0) retryUntil = Date.now() + extractorControlTimeoutMs;
        if (Date.now() >= retryUntil) return state;
        await hostTimers.delay(20);
        client = this.client ?? client;
      } catch (error) {
        if (!isUnavailableExtractor(error)) throw error;
        this.retire(client);
        return "unknown";
      }
    }
  }

  async release(resultId: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.release(resultId);
    } catch (error) {
      if (!isUnavailableExtractor(error)) throw error;
      this.retire(client);
    }
  }

  async shutdown(): Promise<void> {
    let client = this.client;
    this.client = null;
    this.checking = null;
    if (!client && this.starting) {
      try {
        client = await this.starting;
      } catch {
        return;
      }
    }
    this.starting = null;
    if (!client) return;
    try {
      await client.shutdown();
    } catch (error) {
      client.dispose();
      if (!isUnavailableExtractor(error)) throw error;
    }
  }
}

export class SubtitleExtractorProcess {
  static async bootstrap(
    launcher: ProcessLauncher,
    readyFiles: ReadyFileStore,
    options: { tempDirectory: string; fileDirectory?: string },
    executable: string,
  ): Promise<SubtitleExtractorProcessSession> {
    const fileDirectory = options.fileDirectory ?? options.tempDirectory;
    removeStaleHelperFiles(readyFiles, fileDirectory);
    const rpcSessionId = createRpcSessionId();
    const rpcDirectory = `${fileDirectory.replace(/\/+$/, "")}/.rpc/extractor-${rpcSessionId}`;
    const resultDirectory = `${fileDirectory.replace(/\/+$/, "")}/.results/extractor-${rpcSessionId}`;
    const readyFile = createReadyFilePath(fileDirectory, "extractor");
    const nativeReadyFile = `${options.tempDirectory.replace(/\/+$/, "")}/.ready/${readyFile.slice(
      readyFile.lastIndexOf("/") + 1,
    )}`;
    if (readyFiles.exists(readyFile)) {
      try {
        readyFiles.delete(readyFile);
      } catch {
        throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
      }
      throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
    }
    const startedAtMs = Date.now();
    let exitStatus: number | null = null;
    const completion = launcher.launch(executable, [
      "launch",
      "--temp-directory",
      options.tempDirectory,
      "--ready-file",
      nativeReadyFile,
      "--rpc-session",
      rpcSessionId,
    ]);
    void completion.then(
      (result) => {
        exitStatus = result.status;
      },
      () => {
        exitStatus = -1;
      },
    );
    try {
      for (let attempt = 0; attempt < 750; attempt += 1) {
        const output = readyFiles.exists(readyFile) ? readyFiles.read(readyFile) : null;
        if (output !== null)
          return {
            ...parseSubtitleExtractorReadyFrame(output, startedAtMs, Date.now()),
            rpcSessionId,
            rpcDirectory,
            resultDirectory,
          };
        if (exitStatus !== null && exitStatus !== 0)
          throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
        await hostTimers.delay(20);
      }
      throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    } finally {
      try {
        if (readyFiles.exists(readyFile)) readyFiles.delete(readyFile);
      } catch {
        void completion;
      }
    }
  }
}

export function discoverSubtitleExtractorExecutable(
  locator: HelperExecutableLocator,
  pluginId = "io.subtandem.iina",
): string {
  const dataDirectory = locator.resolvePath("@data/.").replace(/\/+$/, "");
  const suffix = `/.data/${pluginId}`;
  if (!dataDirectory.endsWith(suffix)) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
  const pluginsDirectory = dataDirectory.slice(0, -suffix.length);
  const packaged = `${pluginsDirectory}/${pluginId}.iinaplugin/dist/native/subtandem-subtitle-extractor`;
  if (locator.exists(packaged)) return packaged;
  const matches: string[] = [];
  for (const entry of locator.list?.(pluginsDirectory) ?? []) {
    if (!/^[^/]+\.iinaplugin(?:-dev)?$/.test(entry.filename)) continue;
    const root = `${pluginsDirectory}/${entry.filename}`;
    try {
      const metadata = JSON.parse(locator.read?.(`${root}/Info.json`) ?? "") as Record<
        string,
        unknown
      >;
      const candidate = `${root}/dist/native/subtandem-subtitle-extractor`;
      if (metadata.identifier === pluginId && locator.exists(candidate)) matches.push(candidate);
    } catch {
      continue;
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
  return unique[0]!;
}
