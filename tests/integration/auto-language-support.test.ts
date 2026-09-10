import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { TargetLanguageSession } from "../../src/app/target-language-session.js";
import { LanguageDetectionCoordinator } from "../../src/app/language-detection.js";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { loadSubtitleSource } from "../../src/subtitles/source.js";
import type { TranslationBatchRequest, TranslationBatchResult } from "../../src/providers/types.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { utf8Encode } from "../../src/domain/codec.js";

function cues(language: "en" | "zh-Hans" = "en"): SubtitleCue[] {
  const english = [
    "The evening train leaves the quiet station before the rain arrives",
    "Please close the window because the children are already sleeping",
    "We should meet beside the old bridge after breakfast tomorrow",
    "Her brother found the missing letters beneath a wooden chair",
    "Nobody expected the small restaurant to remain open this late",
    "I remember every summer we spent near the northern coast",
    "They promised to bring enough water for the entire journey",
    "A bright lamp was still burning inside the empty library",
    "The doctor asked whether the pain had changed since yesterday",
    "Our neighbors planted flowers along both sides of the narrow road",
    "You can hear the morning birds from the kitchen downstairs",
    "This photograph was taken before the new theater was built",
    "Several passengers waited patiently while the engine was repaired",
    "My grandmother always kept fresh bread beneath a clean towel",
    "The final chapter explains why the travelers returned home early",
    "Someone left a blue umbrella near the entrance to the museum",
  ];
  return Array.from({ length: 64 }, (_, index) => ({
    id: `cue-${index}`,
    index,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    sourceText:
      language === "en"
        ? `${english[index % english.length]} Scene ${index}`
        : `今晚列车离开安静车站朋友们讨论明天旅程头发软件网络后台发展第${index}幕`,
    normalizedText:
      language === "en"
        ? `${english[index % english.length]} Scene ${index}`
        : `今晚列车离开安静车站朋友们讨论明天旅程头发软件网络后台发展第${index}幕`,
  }));
}

class Overlay implements TranslationOverlaySink {
  frames: string[][] = [];
  clears = 0;
  show(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }
  clear(): void {
    this.clears += 1;
  }
}

class Provider {
  requests: TranslationBatchRequest[] = [];
  cancelIds: string[] = [];
  responder: (request: TranslationBatchRequest) => Promise<TranslationBatchResult> = async (
    request,
  ) => ({ translations: request.items.map((item) => ({ id: item.id, text: `T:${item.text}` })) });
  attempt(request: TranslationBatchRequest): Promise<TranslationBatchResult> {
    this.requests.push(request);
    return this.responder(request);
  }
  cancel(requestId: string): void {
    this.cancelIds.push(requestId);
  }
}

describe("automatic language support", () => {
  it("uses subtitle text instead of correct, missing or conflicting track metadata", async () => {
    const body = cues()
      .map(
        (cue, index) =>
          `${index + 1}\n00:00:${String(index).padStart(2, "0")},000 --> 00:00:${String(index).padStart(2, "0")},900\n${cue.normalizedText}\n`,
      )
      .join("\n");
    for (const lang of ["en", undefined, "ja"]) {
      const loaded = loadSubtitleSource(
        { id: 1, isExternal: true, title: "sample.srt", ...(lang ? { lang } : {}) },
        utf8Encode(body),
      );
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      expect(detectSubtitleLanguage(loaded.source.cues)).toEqual({
        state: "reliable",
        languageId: "en",
      });
    }
  });

  it("gates Provider calls until text detection is reliable and skips equal languages", async () => {
    const provider = new Provider();
    const controller = new PlaybackController({
      playerId: "p",
      provider,
      overlay: new Overlay(),
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: cues(), contentHash: "a", language: null, format: "srt" });
    controller.tick(1_000);
    expect(controller.status).toBe("detectingLanguage");
    expect(provider.requests).toHaveLength(0);
    const result = detectSubtitleLanguage(cues());
    expect(result.state).toBe("reliable");
    if (result.state === "reliable") controller.setLanguageDetection(result);
    controller.tick(1_000);
    await controller.whenIdle();
    expect(provider.requests[0]).toMatchObject({ sourceLanguage: "en", targetLanguage: "zh-Hans" });

    const equalProvider = new Provider();
    const equal = new PlaybackController({
      playerId: "equal",
      provider: equalProvider,
      overlay: new Overlay(),
      targetLanguage: "en",
    });
    equal.setSource({ cues: cues(), contentHash: "b", language: null, format: "srt" });
    equal.setLanguageDetection({ languageId: "en" });
    equal.tick(1_000);
    expect(equal.status).toBe("noTranslationNeeded");
    expect(equalProvider.requests).toHaveLength(0);
  });

  it("changes the current target only after matching persistence success", async () => {
    const provider = new Provider();
    const controller = new PlaybackController({
      playerId: "p",
      provider,
      overlay: new Overlay(),
      targetLanguage: "en",
    });
    controller.setSource({ cues: cues(), contentHash: "a", language: null, format: "srt" });
    controller.setLanguageDetection({ languageId: "en" });
    const target = new TargetLanguageSession("en");
    expect(target.begin({ requestId: "save", revision: 1, targetLanguage: "ja" })).toBe(true);
    controller.tick(1_000);
    expect(provider.requests).toHaveLength(0);
    const committed = target.commit({ requestId: "save", targetLanguage: "ja" });
    expect(committed).not.toBeNull();
    controller.setTargetLanguage(committed!.targetLanguage);
    controller.tick(1_000);
    await controller.whenIdle();
    expect(provider.requests[0]?.targetLanguage).toBe("ja");
  });

  it("cancels and rejects old-target work while preserving the reliable source result", async () => {
    let release!: (result: TranslationBatchResult) => void;
    const provider = new Provider();
    provider.responder = () => new Promise((resolve) => (release = resolve));
    const overlay = new Overlay();
    const controller = new PlaybackController({
      playerId: "p",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({ cues: cues(), contentHash: "a", language: null, format: "srt" });
    controller.setLanguageDetection({ languageId: "en" });
    controller.tick(1_000);
    await Promise.resolve();
    controller.setTargetLanguage("ja");
    release({ translations: [{ id: "cue-1", text: "late" }] });
    await controller.whenIdle();
    expect(provider.cancelIds).toHaveLength(1);
    expect(controller.cacheSize).toBe(0);
    expect(overlay.frames).toEqual([]);
    expect(controller.status).toBe("preparing");
  });

  it("keeps independent committed snapshots across player windows", () => {
    const first = new TargetLanguageSession("en");
    const second = new TargetLanguageSession("en");
    first.begin({ requestId: "a", revision: 1, targetLanguage: "ja" });
    first.commit({ requestId: "a", targetLanguage: "ja" });
    expect(first.snapshot.targetLanguage).toBe("ja");
    expect(second.snapshot.targetLanguage).toBe("en");
  });

  it("rejects invalidated detection work and isolates simultaneous windows", async () => {
    const accepted: string[] = [];
    const first = new LanguageDetectionCoordinator({
      yieldControl: async () => undefined,
      detect: () => ({ state: "reliable", languageId: "en" }),
    });
    const invalidated = first.start(
      { playerId: "a", mediaEpoch: 1, trackIdentity: "track", contentHash: "old", cues: cues() },
      (result) => accepted.push(result.contentHash),
    );
    first.invalidate();
    await invalidated;
    const left = new LanguageDetectionCoordinator({ yieldControl: async () => undefined });
    const right = new LanguageDetectionCoordinator({ yieldControl: async () => undefined });
    left.onSeek();
    await Promise.all([
      left.start(
        { playerId: "left", mediaEpoch: 2, trackIdentity: "1", contentHash: "left", cues: cues() },
        (result) => accepted.push(`${result.contentHash}:${result.state}`),
      ),
      right.start(
        {
          playerId: "right",
          mediaEpoch: 8,
          trackIdentity: "9",
          contentHash: "right",
          cues: cues(),
        },
        (result) => accepted.push(`${result.contentHash}:${result.state}`),
      ),
    ]);
    expect(accepted.sort()).toEqual(["left:reliable", "right:reliable"]);
  });
});
