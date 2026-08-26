import { describe, expect, it } from "vitest";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import { DeterministicFakeProvider } from "../../src/providers/fake.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { createTranslationAlignmentFixture } from "../helpers/translation-alignment.js";
import { OverlayPositionPreferences } from "../../src/adapters/iina/overlay-position-preferences.js";
import {
  OverlayPositionAuthority,
  OverlayPositionFollower,
} from "../../src/adapters/iina/overlay-position-sync.js";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { FakeIinaEvent, FakeIinaOverlay, FakeIinaPreferences } from "../helpers/fake-iina.js";

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

const cues: SubtitleCue[] = [
  {
    id: "first",
    index: 0,
    startMs: 0,
    endMs: 1_000,
    sourceText: "first",
    normalizedText: "first",
  },
  {
    id: "second",
    index: 1,
    startMs: 1_000,
    endMs: 2_000,
    sourceText: "second",
    normalizedText: "second",
  },
];

function createController(overlay: RecordingOverlay): PlaybackController {
  const controller = new PlaybackController({
    playerId: "player-A",
    provider: new DeterministicFakeProvider("T:"),
    overlay,
    targetLanguage: "zh-Hans",
  });
  controller.setSource({ cues, contentHash: "lifecycle", language: "en", format: "srt" });
  return controller;
}

describe("translation overlay lifecycle", () => {
  it("restores one saved position after Global, Main and Overlay reconstruction", () => {
    const store = new FakeIinaPreferences();
    new OverlayPositionPreferences(store).save(65);
    const restored = new OverlayPositionPreferences(store).read();
    const authority = new OverlayPositionAuthority(restored.position);
    const follower = new OverlayPositionFollower();
    expect(follower.apply(authority.snapshot())).toBe(true);
    const host = new FakeIinaOverlay();
    const event = new FakeIinaEvent();
    const overlay = new WebViewTranslationOverlay(host, event);
    overlay.setPosition(follower.snapshot.position);
    overlay.show(["current"]);
    event.trigger("iina.plugin-overlay-loaded");
    host.trigger("overlay:ready");
    expect(host.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { position: 65, lines: ["current"] },
    });
  });

  it("uses default zero without writing when the preference is missing", () => {
    const store = new FakeIinaPreferences();
    const restored = new OverlayPositionPreferences(store).read();
    expect(restored).toEqual({ position: 0, source: "default" });
    expect(store.writes).toEqual([]);
    expect(new OverlayPositionAuthority(restored.position).snapshot().position).toBe(0);
  });

  it("converges two windows across interleaved preview, late success and late failure", () => {
    const authority = new OverlayPositionAuthority(0);
    const first = new OverlayPositionFollower();
    const second = new OverlayPositionFollower();
    const preview = authority.preview(20);
    expect(first.apply(preview)).toBe(true);
    expect(second.apply(preview)).toBe(true);
    const olderSave = authority.beginSave(40);
    const newerSave = authority.beginSave(80);
    const newerCommit = authority.commit(newerSave);
    expect(first.apply(newerCommit)).toBe(true);
    expect(second.apply(newerCommit)).toBe(true);
    const lateOldCommit = authority.commit(olderSave);
    expect(first.apply(lateOldCommit)).toBe(false);
    expect(second.apply(lateOldCommit)).toBe(false);
    expect(authority.snapshot()).toMatchObject({
      position: 80,
      committedPosition: 80,
      committedRevision: 1,
    });
    expect(authority.fail(olderSave)).toMatchObject({
      position: 80,
      committedPosition: 80,
      committedRevision: 1,
    });
  });

  it("clears current text across seek, disable and close without changing position", () => {
    const host = new FakeIinaOverlay();
    const event = new FakeIinaEvent();
    const overlay = new WebViewTranslationOverlay(host, event);
    event.trigger("iina.plugin-overlay-loaded");
    host.trigger("overlay:ready");
    overlay.setPosition(70);
    overlay.show(["current"]);
    overlay.clear();
    overlay.setRegion({ top: 0.1, bottom: 0.9, marginX: 16, marginY: 16 });
    overlay.close();
    expect(host.messages.filter((message) => message.name === "overlay:render")).toHaveLength(1);
    expect(host.messages.at(-1)?.name).toBe("overlay:layout");
    expect(host.hideCount).toBe(1);
  });
  it("keeps a paused cue visible and clears it at the half-open boundary", async () => {
    const overlay = new RecordingOverlay();
    const controller = createController(overlay);

    controller.tick(0);
    await controller.whenIdle();
    expect(overlay.frames.at(-1)).toEqual(["T:first"]);
    controller.session.setPaused(true);
    controller.tick(500);
    expect(overlay.frames.at(-1)).toEqual(["T:first"]);
    controller.tick(1_000);
    expect(overlay.clears).toBeGreaterThan(0);
  });

  it("switches adjacent cues without a double display and redraws cached content after seek", async () => {
    const overlay = new RecordingOverlay();
    const controller = createController(overlay);

    controller.tick(0);
    await controller.whenIdle();
    controller.tick(1_000);
    expect(overlay.frames.at(-1)).toEqual(["T:second"]);

    controller.onSeek(0);
    expect(overlay.clears).toBeGreaterThan(0);
    controller.tick(0);
    expect(overlay.frames.at(-1)).toEqual(["T:first"]);
  });

  it("clears each invalidated window without affecting another window", async () => {
    const firstOverlay = new RecordingOverlay();
    const secondOverlay = new RecordingOverlay();
    const first = createController(firstOverlay);
    const second = new PlaybackController({
      playerId: "player-B",
      provider: new DeterministicFakeProvider("B:"),
      overlay: secondOverlay,
      targetLanguage: "zh-Hans",
    });
    second.setSource({ cues, contentHash: "lifecycle", language: "en", format: "srt" });
    first.tick(0);
    second.tick(0);
    await Promise.all([first.whenIdle(), second.whenIdle()]);
    const secondClears = secondOverlay.clears;

    first.setProviderSelection({
      profileId: "profile",
      revision: 1,
      endpointFingerprint: "endpoint",
    });
    first.setEnabled(false);
    first.endFile();
    first.close();

    expect(firstOverlay.clears).toBeGreaterThan(0);
    expect(secondOverlay.clears).toBe(secondClears);
    expect(secondOverlay.frames.at(-1)).toEqual(["B:first"]);
  });

  it("keeps all 20 true overlap pairs separate and source ordered", async () => {
    const { overlappingCues } = createTranslationAlignmentFixture();
    const overlay = new RecordingOverlay();
    const controller = new PlaybackController({
      playerId: "overlap",
      provider: new DeterministicFakeProvider("T:"),
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: overlappingCues,
      contentHash: "overlap",
      language: "en",
      format: "srt",
    });

    for (let pair = 0; pair < 20; pair += 1) {
      controller.tick(pair * 2_000 + 500);
      await controller.whenIdle();
      expect(overlay.frames.at(-1)).toEqual([
        `T:overlap first ${pair + 1}`,
        `T:overlap second ${pair + 1}`,
      ]);
    }
  });
});
