import { describe, expect, it } from "vitest";
import { LanguageDetectionCoordinator } from "../../src/app/language-detection.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

const cues: SubtitleCue[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  index,
  startMs: index * 1_000,
  endMs: index * 1_000 + 900,
  sourceText: "sample",
  normalizedText: "sample",
}));

describe("language detection coordinator", () => {
  it("rejects a late result after source identity changes", async () => {
    const releases: Array<() => void> = [];
    const accepted: string[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      yieldControl: () => new Promise<void>((resolve) => releases.push(resolve)),
      detect: () => ({ state: "reliable", languageId: "en" }),
    });
    const first = coordinator.start(
      { playerId: "p", mediaEpoch: 1, trackIdentity: "1", contentHash: "a", cues },
      (result) => accepted.push(result.contentHash),
    );
    await Promise.resolve();
    const second = coordinator.start(
      { playerId: "p", mediaEpoch: 1, trackIdentity: "2", contentHash: "b", cues },
      (result) => accepted.push(result.contentHash),
    );
    for (let index = 0; index < 10; index += 1) {
      releases.splice(0).forEach((release) => release());
      await Promise.resolve();
    }
    await Promise.all([first, second]);
    expect(accepted).toEqual(["b"]);
  });

  it("fails closed when the five hundred millisecond deadline expires", async () => {
    let now = 0;
    const results: string[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      now: () => now,
      yieldControl: async () => {
        now += 150;
      },
      detect: () => ({ state: "reliable", languageId: "en" }),
    });
    await coordinator.start(
      { playerId: "p", mediaEpoch: 1, trackIdentity: "1", contentHash: "a", cues },
      (result) => results.push(result.state),
    );
    expect(results).toEqual(["unknown"]);
  });

  it("keeps the same-source attempt through seek and invalidates explicit lifecycle events", async () => {
    const results: string[] = [];
    const coordinator = new LanguageDetectionCoordinator({
      yieldControl: async () => undefined,
      detect: () => ({ state: "reliable", languageId: "en" }),
    });
    coordinator.onSeek();
    await coordinator.start(
      { playerId: "p", mediaEpoch: 1, trackIdentity: "1", contentHash: "a", cues },
      (result) => results.push(result.state),
    );
    coordinator.invalidate();
    expect(results).toEqual(["reliable"]);
    expect(coordinator.currentAttempt).toBeNull();
  });
});
