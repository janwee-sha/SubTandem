import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { RecordingProvider } from "../helpers/fake-provider.js";
import { createTranslationAlignmentFixture } from "../helpers/translation-alignment.js";

class LatestOverlay implements TranslationOverlaySink {
  lines: string[] = [];

  show(lines: readonly string[]): void {
    this.lines = [...lines];
  }

  clear(): void {
    this.lines = [];
  }
}

describe("translation content alignment", () => {
  it("keeps 100 continuous translations aligned across logical batches and wire boundaries", async () => {
    const { continuousCues, wireBoundaryIndexes } = createTranslationAlignmentFixture();
    const provider = new RecordingProvider();
    const overlay = new LatestOverlay();
    const controller = new PlaybackController({
      playerId: "alignment",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: continuousCues,
      contentHash: "alignment",
      language: "en",
      format: "srt",
    });

    for (const cue of continuousCues) {
      controller.tick(cue.startMs);
      await controller.whenIdle();
      expect(overlay.lines).toEqual([`translated:${cue.normalizedText}`]);
    }

    const requested = provider.requests.flatMap((request) => request.items);
    expect(new Set(requested.map((target) => target.id))).toEqual(
      new Set(continuousCues.map((cue) => cue.id)),
    );
    for (const boundaryIndex of wireBoundaryIndexes) {
      const target = requested.find((item) => item.id === `continuous-${boundaryIndex}`);
      expect(target).toMatchObject({
        text: `distinct current subtitle ${boundaryIndex}`,
        contextPrevious: `distinct current subtitle ${boundaryIndex - 1}`,
        contextNext: `distinct current subtitle ${boundaryIndex + 1}`,
      });
    }
    expect(
      requested.every(
        (target) => target.text === `distinct current subtitle ${target.id.slice(11)}`,
      ),
    ).toBe(true);
  });

  it("keeps repeated text and instruction-like data attached only to their cue IDs", async () => {
    const { edgeCaseCues } = createTranslationAlignmentFixture();
    const provider = new RecordingProvider();
    const controller = new PlaybackController({
      playerId: "edge-cases",
      provider,
      overlay: new LatestOverlay(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: edgeCaseCues,
      contentHash: "edge",
      language: "en",
      format: "srt",
    });

    controller.tick(0);
    await controller.whenIdle();

    expect(provider.requests.flatMap((request) => request.items)).toEqual(
      expect.arrayContaining(
        edgeCaseCues.map((cue) =>
          expect.objectContaining({ id: cue.id, text: cue.normalizedText }),
        ),
      ),
    );
    expect(controller.cacheSize).toBe(edgeCaseCues.length);
  });
});
