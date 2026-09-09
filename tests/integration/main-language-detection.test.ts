import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFrozenCorpora } from "../helpers/language-corpus.js";
import { createMainLanguagePlayer } from "../helpers/main-language-player.js";

const samples = loadFrozenCorpora().calibration.samples;
const sample = (id: string) => samples.find((item) => item.sampleId === `calibration-${id}`)!;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Main subtitle language entry", () => {
  it("clears a closed window and detects fresh text when IINA reuses its player context", async () => {
    const player = await createMainLanguagePlayer(sample("de-eleven"));
    await player.advance();
    const before = player.requests.length;
    player.close();
    await player.advance();
    expect(player.requests).toHaveLength(before);
    expect(player.controller.cacheSize).toBe(0);
    player.files.set("@sub/1", sample("en-6").bytes);
    player.runtime.core.status.position = sample("en-6").cues[0]!.startMs / 1000;
    player.runtime.event.trigger("iina.file-loaded");
    player.runtime.global.trigger("profile:selected", {
      selection: {
        profileId: "chosen-profile",
        revision: 7,
        endpointFingerprint: "loopback",
        kind: "openai",
      },
    });
    await player.advance(800);
    expect(player.state().source?.detectedLanguage).toBe("en");
    expect(player.requests.slice(before).every((request) => request.sourceLanguage === "en")).toBe(
      true,
    );
    expect(player.requests.length).toBeGreaterThan(before);
    player.runtime.event.trigger("mpv.shutdown");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["de-eleven", "en-ass", "hu-19", "it-19", "ru-19", "sv-19", "zh-31"])(
    "reads %s through Main independently of metadata",
    async (id) => {
      const body = sample(id);
      expect(body).toBeDefined();
      for (const tag of [body.truth.expectedLanguageIds[0], undefined, "private-wrong-label"]) {
        const player = await createMainLanguagePlayer(body, { ...(tag ? { tag } : {}) });
        expect(player.requests).toEqual([]);
        await player.advance();
        expect(player.reads).toContain("@sub/1");
        expect(player.state().source?.detectedLanguage).toBe(body.truth.expectedLanguageIds[0]);
        expect(player.requests.length).toBeGreaterThan(0);
        expect(
          player.requests.every(
            (request) =>
              request.sourceLanguage === body.truth.expectedLanguageIds[0] &&
              request.profileId === "chosen-profile" &&
              request.profileRevision === 7,
          ),
        ).toBe(true);
        player.close();
      }
    },
  );
  it.each([{ enabled: false }, { selected: false }, { target: "de" }])(
    "preserves zero-call gate %j",
    async (options) => {
      const player = await createMainLanguagePlayer(sample("de-eleven"), options);
      await player.advance();
      expect(player.requests).toEqual([]);
      if (options.enabled === false) {
        expect(player.reads).toEqual([]);
        expect(player.metrics()).toEqual([]);
      }
      player.close();
    },
  );
  it("reuses the body candidate for seek and successful target saves, but ignores failed saves", async () => {
    const player = await createMainLanguagePlayer(sample("de-eleven"), { target: "de" });
    await player.advance();
    expect(player.requests).toEqual([]);
    const count = player.metrics().length;
    expect(count).toBe(1);
    player.runtime.event.trigger("mpv.seek");
    const save = (id: string) =>
      player.runtime.sidebar.trigger("defaults:save", {
        requestId: id,
        revision: 1,
        payload: { targetLanguage: "ja" },
      });
    save("save-fail");
    player.runtime.global.trigger("operation:error", {
      requestId: "save-fail",
      code: "TARGET_LANGUAGE_SAVE_FAILED",
      userAction: "NONE",
    });
    await player.advance();
    expect(player.state().targetLanguage).toBe("de");
    expect(player.requests).toEqual([]);
    save("save-ok");
    player.runtime.global.trigger("defaults:saved", { requestId: "save-ok", targetLanguage: "ja" });
    await player.advance();
    expect(player.state().targetLanguage).toBe("ja");
    expect(player.requests.length).toBeGreaterThan(0);
    expect(player.metrics()).toHaveLength(count);
    player.runtime.sidebar.trigger("ui:ready");
    expect(player.state().source?.detectedLanguage).toBe("de");
    player.close();
  });
  it.each(["disable", "close", "end", "file", "track", "body", "unsupported"])(
    "invalidates pending body work on %s",
    async (change) => {
      const player = await createMainLanguagePlayer(sample("de-eleven"));
      if (change === "disable")
        player.runtime.sidebar.trigger("translation:set-enabled", { payload: { enabled: false } });
      if (change === "close") player.close();
      if (change === "end") player.runtime.event.trigger("mpv.end-file");
      if (change === "file") {
        player.files.clear();
        player.runtime.event.trigger("iina.file-loaded");
      }
      if (change === "track") {
        player.runtime.core.subtitle.id = 2;
        player.runtime.event.trigger("mpv.sid.changed");
      }
      if (change === "body") {
        player.files.set("@sub/1", sample("no-letters").bytes);
        player.runtime.event.trigger("mpv.track-list.changed");
      }
      if (change === "unsupported") {
        player.runtime.mpv.set("track-list", [
          {
            type: "sub",
            id: 1,
            selected: true,
            "main-selection": 0,
            external: false,
            codec: "hdmv_pgs_subtitle",
          },
        ]);
        player.runtime.event.trigger("mpv.track-list.changed");
      }
      await player.advance(600);
      expect(player.requests).toEqual([]);
      expect(player.metrics().every((metric) => metric.state !== "reliable")).toBe(true);
      if (change === "close") {
        expect(player.controller.session.closed).toBe(false);
        player.runtime.event.trigger("mpv.shutdown");
        expect(player.controller.session.closed).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      }
      player.close();
    },
  );
  it("keeps two windows isolated and stops using a revoked Profile revision", async () => {
    const a = await createMainLanguagePlayer(sample("de-eleven"), { playerId: "a" });
    const b = await createMainLanguagePlayer(sample("en-ass"), { playerId: "b" });
    a.runtime.global.trigger("profile:revision-created", {
      selectionInvalidated: true,
      profile: { profileId: "chosen-profile" },
    });
    await b.advance();
    expect(a.requests).toEqual([]);
    expect(b.requests.length).toBeGreaterThan(0);
    expect(
      b.requests.every((request) => request.playerId === "b" && request.sourceLanguage === "en"),
    ).toBe(true);
    a.close();
    b.close();
  });
});
