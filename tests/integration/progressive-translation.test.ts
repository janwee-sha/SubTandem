import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import type { TranslationProgressHandler } from "../../src/providers/types.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";

const denseCues = Array.from({ length: 25 }, (_, index): SubtitleCue => ({
  id: `cue-${index + 1}`,
  index,
  startMs: index * 100,
  endMs: index * 100 + 80,
  sourceText: `source-${index + 1}`,
  normalizedText: `source-${index + 1}`,
}));

class RecordingOverlay implements TranslationOverlaySink {
  readonly frames: string[][] = [];
  clears = 0;

  show(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }

  clear(): void {
    this.clears += 1;
  }
}

class FlakyOverlay implements TranslationOverlaySink {
  showAttempts = 0;
  clearAttempts = 0;
  failShow = 1;
  failClear = 1;
  readonly frames: string[][] = [];

  show(lines: readonly string[]): void {
    this.showAttempts += 1;
    if (this.failShow > 0) {
      this.failShow -= 1;
      throw new Error("OVERLAY_SHOW_FAILED");
    }
    this.frames.push([...lines]);
  }

  clear(): void {
    this.clearAttempts += 1;
    if (this.failClear > 0) {
      this.failClear -= 1;
      throw new Error("OVERLAY_CLEAR_FAILED");
    }
  }
}

function controller(
  provider: TranslationProvider,
  overlay: TranslationOverlaySink,
): PlaybackController {
  const value = new PlaybackController({
    playerId: "player-A",
    provider,
    overlay,
    targetLanguage: "zh-Hans",
  });
  value.setSource({ cues: denseCues, contentHash: "dense", language: "en", format: "srt" });
  return value;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("progressive translation output", () => {
  it("keeps a successful DeepSeek wire and commits none of the next invalid wire", async () => {
    let wire = 0;
    const provider = new DeepSeekProvider(
      { endpoint: "https://api.deepseek.com", model: "exact-model" },
      {
        request: async (request) => {
          wire += 1;
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const targets = JSON.parse(messages.at(-1)!.content).targets as Array<{
            id: string;
            text: string;
          }>;
          const translations =
            wire === 2
              ? [{ id: targets[0]!.id, text: `T:${targets[0]!.text}` }]
              : targets.map((target) => ({ id: target.id, text: `T:${target.text}` }));
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify({ translations }) },
                },
              ],
            }),
          };
        },
      },
    );
    const playback = new PlaybackController({
      playerId: "deepseek-progress",
      provider,
      providerKind: "deepseek",
      overlay: new RecordingOverlay(),
      targetLanguage: "zh-Hans",
    });
    playback.setSource({ cues: denseCues, contentHash: "deepseek", language: "en", format: "srt" });

    playback.tick(0);
    await playback.whenIdle();

    expect(wire).toBe(2);
    expect(playback.cacheSize).toBe(2);
    expect(playback.status).toBe("partialFailure");
  });

  it("shows the first valid progress immediately before the logical batch completes", async () => {
    let releaseRest!: () => void;
    const restGate = new Promise<void>((resolve) => {
      releaseRest = resolve;
    });
    let signalFirst!: () => void;
    const firstWireFinished = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    let wireRequests = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        const aggregate: Array<{ id: string; text: string }> = [];
        for (let offset = 0; offset < request.items.length; offset += 2) {
          wireRequests += 1;
          const translations = request.items.slice(offset, offset + 2).map((item) => ({
            id: item.id,
            text: `T:${item.text}`,
          }));
          aggregate.push(...translations);
          onProgress?.({ translations });
          if (offset === 0) {
            signalFirst();
            await restGate;
          }
        }
        return { translations: aggregate };
      },
    };
    const overlay = new RecordingOverlay();
    const playback = controller(provider, overlay);

    playback.tick(0);
    await firstWireFinished;
    expect(overlay.frames.at(-1)).toEqual(["T:source-1"]);
    const firstCacheSize = playback.cacheSize;
    const firstStatus = playback.status;
    releaseRest();
    await playback.whenIdle();

    expect(firstCacheSize).toBe(2);
    expect(firstStatus).toBe("running");
    expect(wireRequests).toBe(13);
    expect(playback.cacheSize).toBe(25);
  });

  it("does not show future progress before its cue becomes current", async () => {
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        const translations = request.items.map((item) => ({ id: item.id, text: `T:${item.text}` }));
        onProgress?.({ translations });
        return { translations };
      },
    };
    const overlay = new RecordingOverlay();
    const playback = controller(provider, overlay);

    playback.tick(0);
    await playback.whenIdle();
    expect(overlay.frames.flat()).not.toContain("T:source-2");

    playback.tick(100);
    expect(overlay.frames.at(-1)).toEqual(["T:source-2"]);
  });

  it("continues switching and clearing current content while the Provider is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let progressed!: () => void;
    const progressReady = new Promise<void>((resolve) => {
      progressed = resolve;
    });
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        const translations = request.items.map((item) => ({
          id: item.id,
          text: `T:${item.text}`,
        }));
        onProgress?.({ translations: translations.slice(0, 2) });
        progressed();
        await gate;
        return { translations };
      },
    };
    const overlay = new RecordingOverlay();
    const playback = controller(provider, overlay);

    playback.tick(0);
    await progressReady;
    expect(overlay.frames.at(-1)).toEqual(["T:source-1"]);
    const clearsBeforeExpiry = overlay.clears;
    playback.tick(80);
    expect(overlay.clears).toBeGreaterThan(clearsBeforeExpiry);
    playback.tick(100);
    expect(overlay.frames.at(-1)).toEqual(["T:source-2"]);
    release();
    await playback.whenIdle();
  });

  it("keeps successful progress and retries only unresolved cues", async () => {
    vi.useFakeTimers();
    const requests: string[][] = [];
    let attempt = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        requests.push(request.items.map((item) => item.id));
        attempt += 1;
        if (attempt === 1) {
          onProgress?.({
            translations: request.items.slice(0, 2).map((item) => ({
              id: item.id,
              text: `T:${item.text}`,
            })),
          });
          throw { category: "network", retryable: true };
        }
        const translations = request.items.map((item) => ({ id: item.id, text: `T:${item.text}` }));
        onProgress?.({ translations });
        return { translations };
      },
    };
    const playback = controller(provider, new RecordingOverlay());

    playback.tick(0);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await playback.whenIdle();

    expect(requests).toHaveLength(2);
    expect(requests[0]).toHaveLength(25);
    expect(requests[1]).toHaveLength(23);
    expect(requests[1]).not.toContain("cue-1");
    expect(requests[1]).not.toContain("cue-2");
    expect(playback.cacheSize).toBe(25);
  });

  it("keeps original directional context after progress removes neighboring targets", async () => {
    vi.useFakeTimers();
    const requests: Array<Array<{ id: string; contextPrevious?: string; contextNext?: string }>> =
      [];
    let attempt = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        requests.push(structuredClone(request.items));
        attempt += 1;
        if (attempt === 1) {
          onProgress?.({ translations: [{ id: "cue-1", text: "done" }] });
          throw { category: "network", retryable: true };
        }
        return {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
      },
    };
    const playback = controller(provider, new RecordingOverlay());

    playback.tick(0);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await playback.whenIdle();

    expect(requests[1]?.find((target) => target.id === "cue-2")).toMatchObject({
      contextPrevious: "source-1",
      contextNext: "source-3",
    });
  });

  it("rejects every duplicate candidate while accepting the unrelated valid subset", async () => {
    vi.useFakeTimers();
    const requestIds: string[][] = [];
    let attempt = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        requestIds.push(request.items.map((item) => item.id));
        attempt += 1;
        if (attempt === 1) {
          const progress = {
            translations: [
              { id: "cue-1", text: "first candidate" },
              { id: "cue-1", text: "second candidate" },
              { id: "cue-2", text: "valid" },
            ],
          };
          onProgress?.(progress);
          return progress;
        }
        return {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
      },
    };
    const playback = controller(provider, new RecordingOverlay());

    playback.tick(0);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await playback.whenIdle();

    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toContain("cue-1");
    expect(requestIds[1]).not.toContain("cue-2");
    expect(playback.cacheSize).toBe(25);
  });

  it("deduplicates progress and terminal results while retaining the cache", async () => {
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        const translations = request.items.map((item) => ({ id: item.id, text: item.text }));
        onProgress?.({ translations });
        return { translations };
      },
    };
    const overlay = new RecordingOverlay();
    const playback = controller(provider, overlay);

    playback.tick(0);
    await playback.whenIdle();

    expect(playback.cacheSize).toBe(25);
    expect(overlay.frames).toEqual([["source-1"]]);
    expect(playback.status).toBe("running");
  });

  it("retries show and clear after synchronous overlay failures on the next tick", async () => {
    const overlay = new FlakyOverlay();
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        const translations = request.items.map((item) => ({ id: item.id, text: `T:${item.text}` }));
        onProgress?.({ translations });
        return { translations };
      },
    };
    const playback = controller(provider, overlay);

    playback.tick(0);
    await playback.whenIdle();
    expect(overlay.frames).toEqual([]);
    playback.tick(0);
    expect(overlay.frames).toEqual([["T:source-1"]]);

    playback.tick(80);
    playback.tick(80);
    expect(overlay.clearAttempts).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["seek", (value: PlaybackController) => value.onSeek(5_000)],
    [
      "track",
      (value: PlaybackController) =>
        value.setSource({ cues: denseCues, contentHash: "next", language: "en", format: "srt" }),
    ],
    ["file", (value: PlaybackController) => value.endFile()],
    [
      "profile",
      (value: PlaybackController) =>
        value.setProviderSelection({
          profileId: "next-profile",
          revision: 2,
          endpointFingerprint: "next-endpoint",
        }),
    ],
    ["disable", (value: PlaybackController) => value.setEnabled(false)],
    ["close", (value: PlaybackController) => value.close()],
  ])("rejects late progress after %s invalidation", async (_name, invalidate) => {
    let lateProgress: TranslationProgressHandler | undefined;
    const provider: TranslationProvider = {
      attempt: (_request, onProgress) => {
        lateProgress = onProgress;
        return new Promise(() => undefined);
      },
      cancel: () => undefined,
    };
    const overlay = new RecordingOverlay();
    const playback = controller(provider, overlay);

    playback.tick(0);
    await Promise.resolve();
    const clearsBeforeInvalidation = overlay.clears;
    invalidate(playback);
    lateProgress?.({ translations: [{ id: "cue-1", text: "late" }] });
    await playback.whenIdle();

    expect(playback.cacheSize).toBe(0);
    expect(overlay.frames).toEqual([]);
    expect(overlay.clears).toBeGreaterThan(clearsBeforeInvalidation);
  });
});
