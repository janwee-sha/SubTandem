import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { DeterministicFakeProvider } from "../../src/providers/fake.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import { parseSrt } from "../../src/subtitles/srt.js";

class RecordingOverlay implements TranslationOverlaySink {
  readonly frames: string[][] = [];
  clears = 0;
  failNextShow = false;

  show(lines: readonly string[]): void {
    if (this.failNextShow) {
      this.failNextShow = false;
      throw new Error("OVERLAY_FAILED");
    }
    this.frames.push([...lines]);
  }

  clear(): void {
    this.clears += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("US1 playback acceptance", () => {
  const cues = parseSrt(
    "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n",
  ).cues;

  it("does not send DeepSeek subtitle or translation content to the translation logger", async () => {
    const logged: string[] = [];
    const controller = new PlaybackController({
      playerId: "deepseek-no-log",
      provider: new DeterministicFakeProvider("PRIVATE_DEEPSEEK_TRANSLATION:"),
      providerKind: "deepseek",
      translationLog: (message) => logged.push(message),
      overlay: new RecordingOverlay(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues, contentHash: "deepseek-log", language: "en", format: "srt" });

    controller.tick(1_000);
    await controller.whenIdle();

    expect(logged).toEqual([]);
  });

  it("shows only the current translation without placeholders or track output", async () => {
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "A",
      provider: new DeterministicFakeProvider("ZH:"),
      overlay,
    });
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });

    controller.tick(1_000);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["ZH:Hello"]);

    controller.tick(2_000);
    expect(overlay.clears).toBeGreaterThan(0);

    controller.tick(3_000);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["ZH:World"]);
    expect(overlay.frames.flat()).not.toContain("pending");
    expect(controller.status).toBe("running");
  });

  it("does not display placeholders or technical errors for unknown, blank, or duplicate output", async () => {
    vi.useFakeTimers();
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: [
          { id: "unknown", text: "outside" },
          { id: request.items[0]!.id, text: " " },
          { id: request.items[1]!.id, text: "first duplicate" },
          { id: request.items[1]!.id, text: "second duplicate" },
        ],
      }),
    };
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({ playerId: "invalid", provider, overlay });
    controller.setSource({ cues, contentHash: "invalid", language: "en", format: "srt" });

    controller.tick(1_000);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await controller.whenIdle();

    expect(overlay.frames).toEqual([]);
    expect(overlay.frames.flat().join(" ")).not.toMatch(/pending|error|unknown|duplicate/i);
    expect(controller.cacheSize).toBe(0);
    expect(controller.status).toBe("serviceUnavailable");
  });

  it("isolates overlay exceptions and retries the current frame on the next tick", async () => {
    const overlay = new RecordingOverlay();
    overlay.failNextShow = true;
    const controller = new PlaybackController({
      playerId: "A",
      provider: new DeterministicFakeProvider("ZH:"),
      overlay,
    });
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });

    controller.tick(1_000);
    await controller.whenIdle();
    expect(controller.status).toBe("running");
    expect(overlay.frames).toEqual([]);

    controller.tick(1_100);
    expect(overlay.frames).toEqual([["ZH:Hello"]]);
  });

  it("does not continuously resubmit terminally failed cues and allows an explicit retry", async () => {
    let attempts = 0;
    const controller = new PlaybackController({
      playerId: "A",
      provider: {
        attempt: async () => {
          attempts += 1;
          throw { category: "protocol", retryable: false };
        },
      },
      overlay: new RecordingOverlay(),
    });
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });

    controller.tick(1_000);
    await controller.whenIdle();
    controller.tick(1_100);
    await controller.whenIdle();
    expect(attempts).toBe(1);
    expect(controller.status).toBe("partialFailure");
    expect(controller.providerError).toMatchObject({ category: "protocol", retryable: false });

    controller.setEnabled(false);
    controller.setEnabled(true);
    controller.tick(1_000);
    await controller.whenIdle();
    expect(attempts).toBe(2);
  });

  it("rejects delayed output after disable and clears the overlay", async () => {
    let resolve!: (value: { translations: Array<{ id: string; text: string }> }) => void;
    const provider = {
      attempt: () =>
        new Promise<{ translations: Array<{ id: string; text: string }> }>(
          (done) => (resolve = done),
        ),
    };
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({ playerId: "A", provider, overlay });
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });
    const clearsBeforeDisable = overlay.clears;
    controller.tick(1_000);
    controller.setEnabled(false);
    resolve({ translations: [{ id: cues[0]!.id, text: "late" }] });
    await controller.whenIdle();

    expect(overlay.frames).toEqual([]);
    expect(overlay.clears).toBeGreaterThan(clearsBeforeDisable);
  });

  it("clears and invalidates delayed output after a source change", async () => {
    let resolve!: (value: { translations: Array<{ id: string; text: string }> }) => void;
    const provider = {
      attempt: () =>
        new Promise<{ translations: Array<{ id: string; text: string }> }>(
          (done) => (resolve = done),
        ),
    };
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({ playerId: "A", provider, overlay });
    controller.setSource({ cues, contentHash: "first", language: "en", format: "srt" });
    controller.tick(1_000);
    const clearsBeforeChange = overlay.clears;
    controller.setSource({ cues, contentHash: "second", language: "en", format: "srt" });
    resolve({ translations: [{ id: cues[0]!.id, text: "late" }] });
    await controller.whenIdle();

    expect(overlay.frames).toEqual([]);
    expect(overlay.clears).toBeGreaterThan(clearsBeforeChange);
  });

  it("keeps a disabled session disabled when source or configuration changes", () => {
    const controller = new PlaybackController({
      playerId: "A",
      provider: new DeterministicFakeProvider("ZH:"),
      overlay: new RecordingOverlay(),
    });
    controller.setEnabled(false);
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });
    expect(controller.status).toBe("disabled");

    controller.setTargetLanguage("zh-Hans");
    expect(controller.status).toBe("disabled");

    controller.setProviderSelection({
      profileId: "profile",
      revision: 1,
      endpointFingerprint: "endpoint",
    });
    expect(controller.status).toBe("disabled");
  });

  it("isolates result, status and overlay content across two windows", async () => {
    const aOverlay = new RecordingOverlay();
    const bOverlay = new RecordingOverlay();
    const a = new PlaybackController({
      playerId: "A",
      provider: new DeterministicFakeProvider("A:"),
      overlay: aOverlay,
    });
    const b = new PlaybackController({
      playerId: "B",
      provider: new DeterministicFakeProvider("B:"),
      overlay: bOverlay,
    });
    a.setSource({ cues, contentHash: "same", language: "en", format: "srt" });
    b.setSource({ cues, contentHash: "same", language: "en", format: "srt" });
    a.tick(1_000);
    b.tick(3_000);
    await Promise.all([a.whenIdle(), b.whenIdle()]);

    expect(aOverlay.frames.at(-1)).toEqual(["A:Hello"]);
    expect(bOverlay.frames.at(-1)).toEqual(["B:World"]);
    const bClears = bOverlay.clears;
    a.setEnabled(false);
    expect(b.status).toBe("running");
    expect(bOverlay.clears).toBe(bClears);
  });

  it("ends one video without permanently closing translation in the same window", async () => {
    const overlay = new RecordingOverlay();
    const provider = new DeterministicFakeProvider("ZH:");
    const controller = new PlaybackController({ playerId: "A", provider, overlay });
    controller.setSource({ cues, contentHash: "first", language: "en", format: "srt" });
    controller.tick(1_000);
    await controller.whenIdle();
    expect(controller.cacheSize).toBeGreaterThan(0);

    controller.endFile();

    expect(controller.cacheSize).toBe(0);
    expect(controller.session.closed).toBe(false);
    expect(controller.status).toBe("waitingForSubtitle");
    expect(overlay.clears).toBeGreaterThan(0);
    controller.setSource({ cues, contentHash: "second", language: "en", format: "srt" });
    controller.tick(3_000);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["ZH:World"]);
  });
});
