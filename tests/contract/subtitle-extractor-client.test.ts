import { describe, expect, it } from "vitest";
import {
  parseSubtitleExtractorReadyFrame,
  SubtitleExtractorClient,
  SubtitleExtractorError,
  SubtitleExtractorProcess,
  SubtitleExtractorSupervisor,
  type ManagedSubtitleExtractorRpcClient,
  type SubtitlePrepareRequest,
  type SubtitleExtractorRpcBridge,
} from "../../src/adapters/iina/subtitle-extractor.js";
import type { ReadyFileStore } from "../../src/adapters/iina/transport-process.js";

class FakeBridge implements SubtitleExtractorRpcBridge {
  readonly calls: Array<{ port: number; path: string; token: string; body: unknown }> = [];

  async post<T>(port: number, token: string, path: string, body: unknown): Promise<T> {
    this.calls.push({ port, path, token, body });
    return {
      jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      state: "ready",
      resultId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      format: "srt",
      cueCount: 1,
      byteCount: 44,
      sha256: "a".repeat(64),
    } as T;
  }
}

class FakeManagedExtractor implements ManagedSubtitleExtractorRpcClient {
  available = true;
  healthCalls = 0;
  prepareCalls = 0;
  disposeCalls = 0;

  async health(): Promise<void> {
    this.healthCalls += 1;
    if (!this.available) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
  }

  async prepare(request: SubtitlePrepareRequest) {
    this.prepareCalls += 1;
    if (!this.available) throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    return {
      jobId: request.jobId,
      state: "ready" as const,
      resultId: request.jobId,
      format: "srt" as const,
      cueCount: 1,
      byteCount: 44,
      sha256: "a".repeat(64),
    };
  }

  async cancel(): Promise<"unknown"> {
    return "unknown";
  }

  async release(): Promise<void> {}

  async shutdown(): Promise<void> {}

  dispose(): void {
    this.disposeCalls += 1;
  }
}

const prepareRequest: SubtitlePrepareRequest = {
  jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  mediaPath: "/private/media/movie.mkv",
  stream: { ffIndex: 3, sourceId: 12, codec: "ass" },
  deadlineMs: 15_000,
  maxCueCount: 20_000,
  maxOutputBytes: 16_777_216,
};

function delayedStart<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

describe("subtitle extractor client contract", () => {
  it("accepts exactly one authenticated protocol-v1 ready frame", () => {
    expect(
      parseSubtitleExtractorReadyFrame(
        '{"type":"ready","port":49152,"token":"abcDEF123_-","protocolVersion":1,"createdAtMs":10000}\n',
        9_000,
        10_000,
      ),
    ).toEqual({
      type: "ready",
      port: 49152,
      token: "abcDEF123_-",
      protocolVersion: 1,
      createdAtMs: 10_000,
    });
    expect(() => parseSubtitleExtractorReadyFrame("debug\n{}")).toThrow();
    expect(() =>
      parseSubtitleExtractorReadyFrame(
        '{"type":"ready","port":49152,"token":"short","protocolVersion":1,"createdAtMs":10000,"path":"private"}',
      ),
    ).toThrow();
  });

  it("rejects expired ready files and removes them", async () => {
    const files = new Map<string, string>();
    const deleted: string[] = [];
    const store: ReadyFileStore = {
      exists: (path) => files.has(path),
      read: (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("IINA_FILE_READ_MISSING");
        return value;
      },
      delete: (path) => {
        deleted.push(path);
        files.delete(path);
      },
    };

    await expect(
      SubtitleExtractorProcess.bootstrap(
        {
          launch: async (_executable, args, onStdout) => {
            expect(onStdout).toBeUndefined();
            files.set(
              args[4]!,
              `${JSON.stringify({
                type: "ready",
                port: 49152,
                token: "abcDEF123_-",
                protocolVersion: 1,
                createdAtMs: Date.now() - 60_000,
              })}\n`,
            );
            return { status: 0 };
          },
        },
        store,
        { tempDirectory: "/private/plugin-tmp" },
        "/private/subtandem-subtitle-extractor",
      ),
    ).rejects.toThrow("EXTRACTOR_PROTOCOL");
    expect(files.size).toBe(0);
    expect(deleted).toHaveLength(1);
  });

  it("waits for a ready file to exist before reading it with IINA semantics", async () => {
    const files = new Map<string, string>();
    const reads: string[] = [];
    const store: ReadyFileStore = {
      exists: (path) => files.has(path),
      read: (path) => {
        reads.push(path);
        const value = files.get(path);
        if (value === undefined) throw new Error("IINA_FILE_READ_MISSING");
        return value;
      },
      delete: (path) => {
        files.delete(path);
      },
    };

    await expect(
      SubtitleExtractorProcess.bootstrap(
        {
          launch: async (_executable, args) => {
            setTimeout(
              () =>
                files.set(
                  args[4]!,
                  `${JSON.stringify({
                    type: "ready",
                    port: 49152,
                    token: "abcDEF123_-",
                    protocolVersion: 1,
                    createdAtMs: Date.now(),
                  })}\n`,
                ),
              1,
            );
            return { status: 0 };
          },
        },
        store,
        { tempDirectory: "/private/plugin-tmp" },
        "/private/subtandem-subtitle-extractor",
      ),
    ).resolves.toMatchObject({ port: 49152, token: "abcDEF123_-" });
    expect(reads).toHaveLength(1);
  });

  it("sends the strict prepare body with a bearer token and accepts metadata only", async () => {
    const bridge = new FakeBridge();
    const client = new SubtitleExtractorClient({ port: 49152, token: "session-token" }, bridge);
    const response = await client.prepare({
      jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      mediaPath: "/private/media/movie.mkv",
      stream: { ffIndex: 3, sourceId: 12, codec: "ass" },
      deadlineMs: 15_000,
      maxCueCount: 20_000,
      maxOutputBytes: 16_777_216,
    });

    expect(bridge.calls).toEqual([
      {
        port: 49152,
        path: "/v1/prepare",
        token: "session-token",
        body: {
          jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
          mediaPath: "/private/media/movie.mkv",
          stream: { ffIndex: 3, sourceId: 12, codec: "ass" },
          deadlineMs: 15_000,
          maxCueCount: 20_000,
          maxOutputBytes: 16_777_216,
        },
      },
    ]);
    expect(response).toEqual({
      jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      state: "ready",
      resultId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      format: "srt",
      cueCount: 1,
      byteCount: 44,
      sha256: "a".repeat(64),
    });
    expect(JSON.stringify(response)).not.toContain("movie.mkv");
    expect(JSON.stringify(response)).not.toContain("subtitle");
  });

  it("rejects malformed result metadata without surfacing response fields", async () => {
    const bridge: SubtitleExtractorRpcBridge = {
      post: async () => ({
        jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
        state: "ready",
        resultId: "wrong",
        format: "srt",
        cueCount: 1,
        byteCount: 44,
        sha256: "a".repeat(64),
        text: "private subtitle",
      }),
    };
    const client = new SubtitleExtractorClient({ port: 49152, token: "session-token" }, bridge);
    await expect(
      client.prepare({
        jobId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
        mediaPath: "/private/media/movie.mkv",
        stream: { ffIndex: 3, sourceId: null, codec: "ass" },
        deadlineMs: 15_000,
        maxCueCount: 20_000,
        maxOutputBytes: 16_777_216,
      }),
    ).rejects.toThrow("EXTRACTOR_PROTOCOL");
  });

  it("uses strict idempotent cancel, release, and shutdown operations", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const bridge: SubtitleExtractorRpcBridge = {
      post: async <T>(_port: number, _token: string, path: string, body: unknown): Promise<T> => {
        calls.push({ path, body });
        if (path === "/v1/cancel") return { state: "unknown" } as T;
        if (path === "/v1/release") return { state: "released" } as T;
        return { state: "shutting-down" } as T;
      },
    };
    const client = new SubtitleExtractorClient({ port: 49152, token: "session-token" }, bridge);
    const id = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";
    await expect(client.cancel(id)).resolves.toBe("unknown");
    await expect(client.release(id)).resolves.toBeUndefined();
    await expect(client.release(id)).resolves.toBeUndefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
    expect(calls).toEqual([
      { path: "/v1/cancel", body: { jobId: id } },
      { path: "/v1/release", body: { resultId: id } },
      { path: "/v1/release", body: { resultId: id } },
      { path: "/v1/shutdown", body: {} },
    ]);
  });

  it("single-flights replacement after an idle extractor generation expires", async () => {
    const expired = new FakeManagedExtractor();
    const replacement = new FakeManagedExtractor();
    let starts = 0;
    const supervisor = new SubtitleExtractorSupervisor(async () => {
      starts += 1;
      return starts === 1 ? expired : replacement;
    });
    await supervisor.health();
    expired.available = false;

    await expect(
      Promise.all([
        supervisor.prepare(prepareRequest, () => true),
        supervisor.prepare(
          { ...prepareRequest, jobId: "8b90a4e6-cc4f-4f59-99b7-8ff522f887af" },
          () => true,
        ),
      ]),
    ).resolves.toHaveLength(2);
    expect(starts).toBe(2);
    expect(expired.disposeCalls).toBe(1);
    expect(expired.prepareCalls).toBe(0);
    expect(replacement.prepareCalls).toBe(2);
  });

  it("claims a completed start before exposing its extractor client", async () => {
    const expired = new FakeManagedExtractor();
    const replacement = new FakeManagedExtractor();
    let starts = 0;
    const supervisor = new SubtitleExtractorSupervisor(() => {
      starts += 1;
      return starts === 1 ? delayedStart(expired) : Promise.resolve(replacement);
    });

    await supervisor.health();
    expired.available = false;
    await expect(supervisor.prepare(prepareRequest, () => true)).resolves.toMatchObject({
      resultId: prepareRequest.jobId,
    });
    expect(starts).toBe(2);
    expect(expired.disposeCalls).toBe(1);
  });

  it("replays one failed prepare only while the same attempt remains current", async () => {
    const failed = new FakeManagedExtractor();
    const replacement = new FakeManagedExtractor();
    let starts = 0;
    const supervisor = new SubtitleExtractorSupervisor(async () => {
      starts += 1;
      return starts === 1 ? failed : replacement;
    });
    await supervisor.health();
    failed.prepare = async () => {
      failed.prepareCalls += 1;
      throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    };
    let current = true;

    await expect(supervisor.prepare(prepareRequest, () => current)).resolves.toMatchObject({
      resultId: prepareRequest.jobId,
    });
    expect(failed.prepareCalls).toBe(1);
    expect(replacement.prepareCalls).toBe(1);

    replacement.prepare = async () => {
      replacement.prepareCalls += 1;
      current = false;
      throw new SubtitleExtractorError("EXTRACTOR_UNAVAILABLE");
    };
    await expect(supervisor.prepare(prepareRequest, () => current)).rejects.toThrow(
      "EXTRACTOR_UNAVAILABLE",
    );
    expect(starts).toBe(2);
  });
});
