import { describe, expect, it, vi } from "vitest";

import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import { RecordingProvider } from "../helpers/fake-provider.js";
import {
  buildFixtureCues,
  loadProviderLanguageDetectionFixture,
} from "../helpers/provider-language-detection.js";

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

const fixture = loadProviderLanguageDetectionFixture();

function sourceFor(testCase: (typeof fixture.cases)[number], contentHash = testCase.id) {
  return {
    cues: buildFixtureCues(testCase),
    contentHash,
    format: "srt" as const,
  };
}

describe("provider language detection", () => {
  it.each(
    fixture.cases
      .filter((testCase) =>
        [
          "short-five-cues",
          "short-eleven-cues-missing-label",
          "medium-natural-dialogue",
          "romanized-dialogue",
          "mixed-language-batch",
        ].includes(testCase.id),
      )
      .map((testCase) => [testCase.id, testCase] as const),
  )("admits %s directly without a local source-language result", async (_id, testCase) => {
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: testCase.id,
      provider,
      overlay: new RecordingOverlay(),
      targetLanguage: testCase.targetLanguage,
    });
    controller.setSource(sourceFor(testCase));

    const readyAt = Date.now();
    controller.tick(0);
    await controller.whenIdle();

    expect(provider.requests).toHaveLength(1);
    expect(Date.now() - readyAt).toBeLessThanOrEqual(500);
    expect(provider.requests[0]!.targetLanguage).toBe(testCase.targetLanguage);
    expect(provider.requests[0]).not.toHaveProperty("sourceLanguage");
    expect(provider.requests[0]!.items.length).toBeLessThanOrEqual(25);
    expect(
      provider.requests[0]!.items.reduce((total, item) => total + [...item.text].length, 0),
    ).toBeLessThanOrEqual(5_000);
  });

  it("retries only unresolved frozen targets without detecting between attempts", async () => {
    vi.useFakeTimers();
    const testCase = fixture.cases.find((entry) => entry.id === "mixed-language-batch")!;
    const attempts: string[][] = [];
    let attempt = 0;
    const provider: TranslationProvider = {
      attempt: async (request, onProgress) => {
        attempts.push(request.items.map((item) => item.id));
        attempt += 1;
        if (attempt === 1) {
          onProgress?.({ translations: [{ id: request.items[0]!.id, text: "same" }] });
          throw { category: "network", retryable: true };
        }
        return {
          translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })),
        };
      },
    };
    const controller = new PlaybackController({
      playerId: "retry",
      provider,
      overlay: new RecordingOverlay(),
      targetLanguage: testCase.targetLanguage,
      random: () => 0,
    });
    controller.setSource(sourceFor(testCase));

    controller.tick(0);
    await vi.runAllTimersAsync();
    await controller.whenIdle();

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]!.slice(1));
    expect(controller.status).toBe("running");
    vi.useRealTimers();
  });

  it("rejects delayed results after source, target, profile, disable, seek, end, or close changes", async () => {
    const testCase = fixture.cases.find((entry) => entry.id === "short-five-cues")!;
    const changes = [
      (controller: PlaybackController) => controller.setSource(sourceFor(testCase, "next")),
      (controller: PlaybackController) => controller.setTargetLanguage("fr"),
      (controller: PlaybackController) =>
        controller.setProviderSelection({
          profileId: "next-profile",
          revision: 2,
          endpointFingerprint: "next-endpoint",
          kind: "openai",
        }),
      (controller: PlaybackController) => controller.setEnabled(false),
      (controller: PlaybackController) => controller.onSeek(2_000),
      (controller: PlaybackController) => controller.endFile(),
      (controller: PlaybackController) => controller.close(),
    ];

    for (const [index, change] of changes.entries()) {
      let resolve!: (value: { translations: Array<{ id: string; text: string }> }) => void;
      const overlay = new RecordingOverlay();
      const provider: TranslationProvider = {
        attempt: (request) =>
          new Promise((done) => {
            resolve = done;
            expect(request).not.toHaveProperty("sourceLanguage");
          }),
      };
      const controller = new PlaybackController({
        playerId: `lifecycle-${index}`,
        provider,
        overlay,
        targetLanguage: testCase.targetLanguage,
      });
      controller.setSource(sourceFor(testCase));
      controller.tick(0);
      const clearsBeforeChange = overlay.clears;
      change(controller);
      resolve({ translations: [{ id: buildFixtureCues(testCase)[0]!.id, text: "late" }] });
      await controller.whenIdle();

      expect(overlay.frames).toEqual([]);
      expect(overlay.clears).toBeGreaterThan(clearsBeforeChange);
    }
  });

  it("isolates simultaneous windows and keeps bounded seek windows", async () => {
    const testCase = fixture.cases.find((entry) => entry.id === "medium-natural-dialogue")!;
    const providers = [new RecordingProvider(), new RecordingProvider()];
    const overlays = [new RecordingOverlay(), new RecordingOverlay()];
    const controllers = providers.map((provider, index) => {
      const controller = new PlaybackController({
        playerId: `window-${index}`,
        provider,
        overlay: overlays[index]!,
        targetLanguage: testCase.targetLanguage,
      });
      controller.setSource(sourceFor(testCase));
      return controller;
    });

    controllers[0]!.tick(0);
    controllers[1]!.tick(24_000);
    await Promise.all(controllers.map((controller) => controller.whenIdle()));

    expect(providers[0]!.requests[0]!.playerId).toContain("window-0");
    expect(providers[1]!.requests[0]!.playerId).toContain("window-1");
    expect(providers.flatMap((provider) => provider.requests).every((request) => request.items.length <= 25)).toBe(true);
    expect(overlays[0]!.frames.flat()).not.toEqual(overlays[1]!.frames.flat());
  });
});
