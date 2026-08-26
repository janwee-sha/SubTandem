import { describe, expect, it } from "vitest";
import {
  parseSubtitleExtractorReadyFrame,
  SubtitleExtractorClient,
  type SubtitleExtractorHttpBridge,
} from "../../src/adapters/iina/subtitle-extractor.js";

class FakeBridge implements SubtitleExtractorHttpBridge {
  readonly calls: Array<{ url: string; token: string; body: unknown }> = [];

  async post<T>(url: string, token: string, body: unknown): Promise<T> {
    this.calls.push({ url, token, body });
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

describe("subtitle extractor client contract", () => {
  it("accepts exactly one authenticated protocol-v1 ready frame", () => {
    expect(
      parseSubtitleExtractorReadyFrame(
        '{"type":"ready","port":49152,"token":"abcDEF123_-","protocolVersion":1}\n',
      ),
    ).toEqual({ type: "ready", port: 49152, token: "abcDEF123_-", protocolVersion: 1 });
    expect(() => parseSubtitleExtractorReadyFrame("debug\n{}")).toThrow();
    expect(() =>
      parseSubtitleExtractorReadyFrame(
        '{"type":"ready","port":49152,"token":"short","protocolVersion":1,"path":"private"}',
      ),
    ).toThrow();
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
        url: "http://127.0.0.1:49152/v1/prepare",
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
    const bridge: SubtitleExtractorHttpBridge = {
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
    const bridge: SubtitleExtractorHttpBridge = {
      post: async <T>(url: string, _token: string, body: unknown): Promise<T> => {
        const path = new URL(url).pathname;
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
});
