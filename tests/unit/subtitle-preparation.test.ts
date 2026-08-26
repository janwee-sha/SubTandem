import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitlePreparationCoordinator } from "../../src/app/subtitle-preparation.js";
import { utf8Encode } from "../../src/domain/codec.js";
import { sha256Hex } from "../../src/domain/identity.js";
import type {
  SubtitleExtractorRpcClient,
  SubtitlePrepareRequest,
} from "../../src/adapters/iina/subtitle-extractor.js";
import { SubtitleExtractorError } from "../../src/adapters/iina/subtitle-extractor.js";
import type { ExtractedSubtitleResult } from "../../src/subtitles/types.js";

const bytes = utf8Encode("1\n00:00:01,000 --> 00:00:02,000\nHello\n");
const ids = [
  "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  "8b90a4e6-cc4f-4f59-99b7-8ff522f887af",
  "9c90a4e6-cc4f-4f59-99b7-8ff522f887b0",
  "ad90a4e6-cc4f-4f59-99b7-8ff522f887b1",
];

class DeferredExtractor implements SubtitleExtractorRpcClient {
  requests: SubtitlePrepareRequest[] = [];
  cancelled: string[] = [];
  released: string[] = [];
  shutdowns = 0;
  private resolvePrepare!: (value: ExtractedSubtitleResult) => void;
  readonly result = new Promise<ExtractedSubtitleResult>((resolve) => {
    this.resolvePrepare = resolve;
  });

  prepare(request: SubtitlePrepareRequest): Promise<ExtractedSubtitleResult> {
    this.requests.push(request);
    return this.result;
  }
  async cancel(jobId: string): Promise<"cancelled"> {
    this.cancelled.push(jobId);
    return "cancelled";
  }
  async release(resultId: string): Promise<void> {
    this.released.push(resultId);
  }
  async shutdown(): Promise<void> {
    this.shutdowns += 1;
  }
  resolve(jobId = this.requests[0]!.jobId): void {
    this.resolvePrepare({
      jobId,
      state: "ready",
      resultId: jobId,
      format: "srt",
      cueCount: 1,
      byteCount: bytes.length,
      sha256: sha256Hex(bytes),
    });
  }
}

const media = (epoch = 1) => ({
  playerId: "player-A",
  mediaEpoch: epoch,
  localPath: "/private/media/movie.mkv",
  isNetworkResource: false,
});
const track = (trackId = 7) => ({
  trackId,
  origin: "embedded" as const,
  codec: "ass" as const,
  ffIndex: trackId,
  sourceId: trackId + 10,
  language: "en",
});

afterEach(() => vi.useRealTimers());

describe("subtitle preparation lifecycle", () => {
  it.each(["subrip", "ass", "ssa"] as const)(
    "keeps the mpv Matroska source ID in session identity without comparing it to libavformat for %s",
    async (codec) => {
      const extractor = new DeferredExtractor();
      let sequence = 0;
      const coordinator = new SubtitlePreparationCoordinator({
        playerId: "player-A",
        extractor,
        readResult: () => bytes,
        createId: () => ids[sequence++]!,
      });
      const selectedTrack = {
        trackId: 7,
        origin: "embedded" as const,
        codec,
        ffIndex: 3,
        sourceId: 12,
        language: "en",
      };

      const pending = coordinator.prepare(media(), selectedTrack);
      expect(extractor.requests[0]?.stream).toEqual({ ffIndex: 3, sourceId: null, codec });
      extractor.resolve(ids[1]);
      await expect(pending).resolves.toMatchObject({ trackId: 7, codec });
    },
  );

  it("forwards a comparable MOV/MP4 track ID to libavformat", async () => {
    const extractor = new DeferredExtractor();
    let sequence = 0;
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor,
      readResult: () => bytes,
      createId: () => ids[sequence++]!,
    });
    const pending = coordinator.prepare(
      { ...media(), localPath: "/private/media/movie.mp4" },
      {
        trackId: 7,
        origin: "embedded",
        codec: "mov_text",
        ffIndex: 3,
        sourceId: 12,
        language: "en",
      },
    );

    expect(extractor.requests[0]?.stream).toEqual({
      ffIndex: 3,
      sourceId: 12,
      codec: "mov_text",
    });
    extractor.resolve(ids[1]);
    await expect(pending).resolves.toMatchObject({ trackId: 7, codec: "mov_text" });
  });

  it.each(["track", "media", "stop", "disable", "close"])(
    "invalidates before cancellation on %s and releases the late result",
    async () => {
      const extractor = new DeferredExtractor();
      let sequence = 0;
      const coordinator = new SubtitlePreparationCoordinator({
        playerId: "player-A",
        extractor,
        readResult: () => bytes,
        createId: () => ids[sequence++]!,
      });
      const pending = coordinator.prepare(media(), track());
      coordinator.invalidate("invalidated");
      expect(coordinator.view?.state).toBe("invalidated");
      expect(extractor.cancelled).toEqual([ids[1]]);
      extractor.resolve(ids[1]);
      await expect(pending).resolves.toBeNull();
      expect(extractor.released).toEqual([ids[1]]);
      expect(coordinator.source).toBeNull();
    },
  );

  it("does not cancel preparation on seek", async () => {
    const extractor = new DeferredExtractor();
    let sequence = 0;
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor,
      readResult: () => bytes,
      createId: () => ids[sequence++]!,
    });
    const pending = coordinator.prepare(media(), track());
    coordinator.onSeek();
    expect(extractor.cancelled).toEqual([]);
    extractor.resolve(ids[1]);
    await expect(pending).resolves.toMatchObject({ trackId: 7 });
  });

  it("times out at 15 seconds, invalidates first, and releases a late result", async () => {
    vi.useFakeTimers();
    const extractor = new DeferredExtractor();
    let sequence = 0;
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor,
      readResult: () => bytes,
      createId: () => ids[sequence++]!,
    });
    const pending = coordinator.prepare(media(), track());
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toBeNull();
    expect(coordinator.view).toMatchObject({ state: "timedOut", canRetry: true });
    expect(extractor.cancelled).toEqual([ids[1]]);
    extractor.resolve(ids[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(extractor.released).toEqual([ids[1]]);
  });

  it("requires player, media epoch, track identity, and attempt identity together", async () => {
    const extractor = new DeferredExtractor();
    let sequence = 0;
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor,
      readResult: () => bytes,
      createId: () => ids[sequence++]!,
    });
    const pending = coordinator.prepare(media(1), track(7));
    coordinator.invalidateForSelection(media(2), track(8));
    extractor.resolve(ids[1]);
    await expect(pending).resolves.toBeNull();
    expect(coordinator.source).toBeNull();
  });

  it.each([
    ["EMPTY_OR_UNREADABLE", "emptyOrUnreadable"],
    ["OUTPUT_LIMIT", "emptyOrUnreadable"],
    ["EXTRACTION_FAILED", "failed"],
  ] as const)("maps %s to the safe retryable %s state", async (code, state) => {
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor: {
        prepare: async () => Promise.reject(new SubtitleExtractorError(code)),
        cancel: async () => "unknown",
        release: async () => undefined,
        shutdown: async () => undefined,
      },
      readResult: () => null,
      createId: () => ids[0]!,
    });
    await expect(coordinator.prepare(media(), track())).resolves.toBeNull();
    expect(coordinator.view).toMatchObject({ state, canRetry: true, canReselect: true });
  });

  it("retries only explicitly and creates a fresh attempt and job identity", async () => {
    let sequence = 0;
    const requests: SubtitlePrepareRequest[] = [];
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor: {
        prepare: async (request) => {
          requests.push(request);
          throw new SubtitleExtractorError("EXTRACTION_FAILED");
        },
        cancel: async () => "unknown",
        release: async () => undefined,
        shutdown: async () => undefined,
      },
      readResult: () => null,
      createId: () => ids[sequence++]!,
    });

    await coordinator.prepare(media(), track());
    expect(requests).toHaveLength(1);
    expect(coordinator.view?.state).toBe("failed");
    void coordinator.view;
    void coordinator.view;
    expect(requests).toHaveLength(1);
    await coordinator.retry();
    expect(requests.map((request) => request.jobId)).toEqual([ids[1], ids[3]]);
  });

  it("rejects retry after the failed selection has been invalidated", async () => {
    let requests = 0;
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor: {
        prepare: async () => {
          requests += 1;
          throw new SubtitleExtractorError("EXTRACTION_FAILED");
        },
        cancel: async () => "unknown",
        release: async () => undefined,
        shutdown: async () => undefined,
      },
      readResult: () => null,
      createId: () => ids[0]!,
    });
    await coordinator.prepare(media(), track());
    coordinator.invalidate("invalidated");
    await expect(coordinator.retry()).resolves.toBeNull();
    expect(requests).toBe(1);
  });
});
