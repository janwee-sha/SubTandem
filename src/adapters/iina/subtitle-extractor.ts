import type { EmbeddedSubtitleCodec, ExtractedSubtitleResult } from "../../subtitles/types.js";
import type { HelperExecutableLocator, ProcessLauncher, ReadyFrame } from "./transport-process.js";

export interface SubtitleExtractorHttpBridge {
  post<T>(url: string, bearerToken: string, body: unknown): Promise<T>;
}

export interface SubtitleExtractorSession {
  port: number;
  token: string;
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

export function parseSubtitleExtractorReadyFrame(output: string): ReadyFrame {
  if (output.split("\n").filter(Boolean).length !== 1)
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  }
  const frame = exactObject(value, ["type", "port", "token", "protocolVersion"]);
  if (
    frame.type !== "ready" ||
    frame.protocolVersion !== 1 ||
    !Number.isInteger(frame.port) ||
    (frame.port as number) < 1024 ||
    (frame.port as number) > 65535 ||
    typeof frame.token !== "string" ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(frame.token)
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
  prepare(request: SubtitlePrepareRequest): Promise<ExtractedSubtitleResult>;
  cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown">;
  release(resultId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export class SubtitleExtractorClient implements SubtitleExtractorRpcClient {
  private shutdownRequest: Promise<void> | null = null;

  constructor(
    private readonly session: SubtitleExtractorSession,
    private readonly bridge: SubtitleExtractorHttpBridge,
  ) {
    if (
      !Number.isInteger(session.port) ||
      session.port < 1024 ||
      session.port > 65535 ||
      !/^[A-Za-z0-9_-]{8,512}$/.test(session.token)
    )
      throw new SubtitleExtractorError("INVALID_REQUEST");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    try {
      return await this.bridge.post<T>(
        `http://127.0.0.1:${this.session.port}${path}`,
        this.session.token,
        body,
      );
    } catch (error) {
      if (error instanceof SubtitleExtractorError) throw error;
      throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    }
  }

  async prepare(request: SubtitlePrepareRequest): Promise<ExtractedSubtitleResult> {
    validatePrepareRequest(request);
    return validateResult(await this.post("/v1/prepare", request), request);
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
    const response = exactObject(await this.post("/v1/shutdown", {}), ["state"]);
    if (response.state !== "shutting-down") throw new SubtitleExtractorError("EXTRACTOR_PROTOCOL");
  }
}

export class SubtitleExtractorProcess {
  static async bootstrap(
    launcher: ProcessLauncher,
    options: { tempDirectory: string; parentPid?: number },
    executable: string,
  ): Promise<SubtitleExtractorSession> {
    let stdout = "";
    let exitStatus: number | null = null;
    const completion = launcher.launch(
      executable,
      [
        "--temp-directory",
        options.tempDirectory,
        ...(options.parentPid === undefined ? [] : ["--parent-pid", String(options.parentPid)]),
      ],
      (data) => {
        stdout += data;
      },
    );
    void completion.then(
      (result) => {
        exitStatus = result.status;
      },
      () => {
        exitStatus = -1;
      },
    );
    for (let attempt = 0; attempt < 750 && !stdout.includes("\n"); attempt += 1) {
      if (exitStatus !== null) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    if (!stdout.includes("\n")) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    return parseSubtitleExtractorReadyFrame(stdout.slice(0, stdout.indexOf("\n") + 1));
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
