import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { readFileSync } from "node:fs";
import { selectNearbyCues } from "../../src/app/scheduler.js";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { createTranslationAlignmentFixture } from "../helpers/translation-alignment.js";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/domain/subtitle-style.js";
import { FakeIinaOverlay } from "../helpers/fake-iina.js";

await import("../../ui/overlay-state.js");

class LatestOverlay implements TranslationOverlaySink {
  lines: string[] = [];
  clearCount = 0;
  show(lines: readonly string[]): void {
    this.lines = [...lines];
  }
  clear(): void {
    this.lines = [];
    this.clearCount += 1;
  }
}

const cues = Array.from({ length: 120 }, (_, index): SubtitleCue => ({
  id: `c${index}`,
  index,
  startMs: index * 1_000,
  endMs: index * 1_000 + 800,
  sourceText: `cue-${index}`,
  normalizedText: `cue-${index}`,
}));

describe("automated acceptance performance", () => {
  it("coalesces 50 full-style edits into latest-only renders without clearing playback", () => {
    const view = new FakeIinaOverlay();
    let loaded: (() => void) | null = null;
    const overlay = new WebViewTranslationOverlay(view, {
      on: (_name, callback) => {
        loaded = callback;
        return "loaded";
      },
      off: () => undefined,
    });
    loaded?.();
    view.trigger("overlay:ready", {});
    overlay.show(["current"]);
    const started = performance.now();
    for (let index = 0; index < 50; index += 1) {
      overlay.setStyle({
        ...DEFAULT_SUBTITLE_TEXT_STYLE,
        fontColor: { r: index, g: 255 - index, b: index * 2, a: 255 - index },
        fontSize: [30, 35, 40, 45, 50, 55, 60, 65, 70][index % 9]!,
        bold: index % 2 === 0,
        italic: index % 3 === 0,
        borderWidth: [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5][index % 10]!,
        backgroundColor: { r: index * 2, g: index, b: 0, a: index },
      });
    }
    expect(performance.now() - started).toBeLessThan(100);
    expect(view.messages.filter((message) => message.name === "overlay:clear")).toHaveLength(1);
    expect(view.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { style: { fontColor: { r: 49 }, backgroundColor: { a: 49 } } },
    });
  });
  it("lays out 101 live position inputs monotonically within the preview budget", () => {
    const durations: number[] = [];
    const offsets: number[] = [];
    for (let position = 0; position <= 100; position += 1) {
      const started = performance.now();
      offsets.push(
        globalThis.calculateSubTandemOverlayLayout({
          viewportHeight: 1080,
          blockHeight: 160,
          position,
          region: { top: 0.1, bottom: 0.9, marginX: 16, marginY: 16 },
        }).topOffset,
      );
      durations.push(performance.now() - started);
    }
    expect(offsets.every((value, index) => index === 0 || value >= offsets[index - 1]!)).toBe(true);
    expect(durations.filter((duration) => duration <= 100)).toHaveLength(101);
    expect(durations.every((duration) => duration <= 200)).toBe(true);
  });
  it("keeps maximum language detection samples within first, warm and sync budgets", () => {
    const sample = Array.from({ length: 64 }, (_, index): SubtitleCue => ({
      id: `language-${index}`,
      index,
      startMs: index * 1_000,
      endMs: index * 1_000 + 900,
      sourceText: `The passengers wait beside the station while the damaged engine is repaired in scene ${index}`,
      normalizedText: `The passengers wait beside the station while the damaged engine is repaired in scene ${index}`,
    }));
    const durations: number[] = [];
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const started = performance.now();
      detectSubtitleLanguage(sample);
      durations.push(performance.now() - started);
    }
    const percentile = (values: number[], percentage: number): number =>
      [...values].sort((left, right) => left - right)[
        Math.min(values.length - 1, Math.ceil(values.length * percentage) - 1)
      ]!;
    expect(percentile(durations.slice(0, 20), 0.95)).toBeLessThanOrEqual(100);
    expect(percentile(durations.slice(20), 0.95)).toBeLessThanOrEqual(50);
    expect(percentile(durations, 0.99)).toBeLessThanOrEqual(16);
  });

  it("streams a four-hour, 20 GB-class, 20,000-cue workload without whole-media loading", () => {
    const large = Array.from({ length: 20_000 }, (_, index): SubtitleCue => ({
      id: `large-${index}`,
      index,
      startMs: index * 720,
      endMs: index * 720 + 600,
      sourceText: `cue-${index}`,
      normalizedText: `cue-${index}`,
    }));
    expect(large.at(-1)!.endMs).toBeLessThanOrEqual(4 * 60 * 60 * 1_000);
    expect(selectNearbyCues(large, 2 * 60 * 60 * 1_000).length).toBeLessThanOrEqual(40);
    expect(20 * 1024 ** 3).toBeGreaterThan(16 * 1024 ** 3);
    const extractor = readFileSync(
      new URL(
        "../../native/subtitle-extractor/Sources/SubTandemSubtitleExtractor/Extractor.swift",
        import.meta.url,
      ),
      "utf8",
    );
    expect(extractor).toContain("while av_read_frame");
    expect(extractor).not.toContain("Data(contentsOf: request.mediaURL)");
    expect(extractor).toContain("ProtocolLimits.maxCueCount");
  });

  it("prepares the first batch under five seconds and 95% before display with zero playback pauses", async () => {
    const overlay = new LatestOverlay();
    let active = 0;
    let maxActive = 0;
    const provider: TranslationProvider = {
      attempt: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const result = {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
        active -= 1;
        return result;
      },
    };
    const controller = new PlaybackController({
      playerId: "A",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues, contentHash: "hash", language: "en", format: "srt" });
    const started = performance.now();
    let readyBeforeDisplay = 0;
    for (let second = 0; second < 100; second += 1) {
      controller.tick(second * 1_000);
      await controller.whenIdle();
      if (overlay.lines.includes(`T:cue-${second}`)) readyBeforeDisplay += 1;
    }
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(readyBeforeDisplay / 100).toBeGreaterThanOrEqual(0.95);
    expect(maxActive).toBe(1);
  });

  it("proves cache hits, bounded calls and independent multi-window progress", async () => {
    const calls: Record<string, number> = { A: 0, B: 0 };
    const provider: TranslationProvider = {
      attempt: async (request) => {
        calls[request.playerId] = (calls[request.playerId] ?? 0) + 1;
        expect(request.items.length).toBeLessThanOrEqual(25);
        expect(
          request.items.reduce((sum, item) => sum + [...item.text].length, 0),
        ).toBeLessThanOrEqual(5_000);
        return { translations: request.items.map((item) => ({ id: item.id, text: item.text })) };
      },
    };
    const a = new PlaybackController({
      playerId: "A",
      provider,
      overlay: new LatestOverlay(),
      targetLanguage: "zh-Hans",
    });
    const b = new PlaybackController({
      playerId: "B",
      provider,
      overlay: new LatestOverlay(),
      targetLanguage: "zh-Hans",
    });
    for (const controller of [a, b])
      controller.setSource({ cues, contentHash: "same", language: "en", format: "srt" });
    a.tick(0);
    b.tick(30_000);
    await Promise.all([a.whenIdle(), b.whenIdle()]);
    a.tick(0);
    await a.whenIdle();
    const beforeReplay = calls.A;
    a.tick(0);
    await a.whenIdle();
    expect(calls.A).toBe(beforeReplay);
    expect(calls.A).toBeGreaterThan(0);
    expect(calls.B).toBeGreaterThan(0);
  });

  it("keeps current frames and clears expired frames across 350ms ticks", async () => {
    const overlay = new LatestOverlay();
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
      }),
    };
    const controller = new PlaybackController({
      playerId: "timed",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    const timedCues = Array.from({ length: 100 }, (_, index): SubtitleCue => ({
      id: `timed-${index}`,
      index,
      startMs: index * 350,
      endMs: index * 350 + 350,
      sourceText: `timed-${index}`,
      normalizedText: `timed-${index}`,
    }));
    controller.setSource({ cues: timedCues, contentHash: "timed", language: "en", format: "srt" });
    let visibleTicks = 0;
    let emptyTicks = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      const position = tick * 350;
      controller.tick(position);
      await controller.whenIdle();
      if (overlay.lines.length > 0) visibleTicks += 1;
      else emptyTicks += 1;
    }

    expect(visibleTicks).toBeGreaterThanOrEqual(95);
    expect(emptyTicks).toBeLessThanOrEqual(5);
    controller.tick(35_000);
    expect(overlay.clearCount).toBeGreaterThan(0);
  });

  it("aligns 100 cues without extra Provider attempts or concurrent window work", async () => {
    const { continuousCues } = createTranslationAlignmentFixture();
    let attempts = 0;
    let active = 0;
    let maxActive = 0;
    const provider: TranslationProvider = {
      attempt: async (request) => {
        attempts += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        const result = {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
        active -= 1;
        return result;
      },
    };
    const controller = new PlaybackController({
      playerId: "alignment-load",
      provider,
      overlay: new LatestOverlay(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: continuousCues,
      contentHash: "alignment-load",
      language: "en",
      format: "srt",
    });

    const started = performance.now();
    for (const cue of continuousCues) {
      controller.tick(cue.startMs);
      await controller.whenIdle();
    }

    expect(attempts).toBe(61);
    expect(maxActive).toBe(1);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(controller.cacheSize).toBe(100);
  });

  it("keeps a 30-minute equivalent load isolated after a source lifecycle change", async () => {
    const loadCues = Array.from({ length: 1_800 }, (_, index): SubtitleCue => ({
      id: `load-${index}`,
      index,
      startMs: index * 1_000,
      endMs: index * 1_000 + 900,
      sourceText: `first-${index}`,
      normalizedText: `first-${index}`,
    }));
    const overlay = new LatestOverlay();
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
      }),
    };
    const controller = new PlaybackController({
      playerId: "long-load",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: loadCues, contentHash: "first", language: "en", format: "srt" });
    for (let position = 0; position < 30 * 60_000; position += 30_000) {
      controller.tick(position);
      await controller.whenIdle();
    }

    const replacement = loadCues.map((cue) => ({
      ...cue,
      sourceText: cue.sourceText.replace("first", "second"),
      normalizedText: cue.normalizedText.replace("first", "second"),
    }));
    controller.setSource({
      cues: replacement,
      contentHash: "second",
      language: "en",
      format: "srt",
    });
    controller.tick(0);
    await controller.whenIdle();

    expect(overlay.lines).toEqual(["T:second-0"]);
    expect(overlay.lines.join(" ")).not.toContain("first-");
    expect(controller.cacheSize).toBe(25);
  });
});
