import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { uiLanguageRuntime } from "../helpers/ui-language-runtime.js";
import { describe, expect, it, vi } from "vitest";
import { WebViewTranslationOverlay } from "../../src/runtime/adapters/iina/webview-translation-overlay.js";
import { SubtitleStylePreferences } from "../../src/runtime/adapters/iina/subtitle-style-preferences.js";
import { SubtitleStyleAuthority } from "../../src/runtime/adapters/iina/subtitle-style-sync.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/runtime/domain/subtitle-style.js";
import { FakeIinaOverlay, FakeIinaPreferences } from "../helpers/fake-iina.js";

class FakeLifecycle {
  private callback: (() => void) | null = null;

  on(_name: "iina.plugin-overlay-loaded", callback: () => void): string {
    this.callback = callback;
    return "overlay-loaded";
  }

  off(): void {}

  trigger(): void {
    this.callback?.();
  }
}

const readyOverlay = () => {
  const view = new FakeIinaOverlay();
  const lifecycle = new FakeLifecycle();
  const overlay = new WebViewTranslationOverlay(view, lifecycle);
  lifecycle.trigger();
  view.trigger("overlay:ready", {});
  return { view, overlay };
};

describe("subtitle style lifecycle", () => {
  it("updates a currently visible real translation immediately with all Font fields", () => {
    const { view, overlay } = readyOverlay();
    overlay.show(["current translation"]);
    const style = {
      ...DEFAULT_SUBTITLE_TEXT_STYLE,
      fontColor: { r: 12, g: 34, b: 56, a: 128 },
      fontSize: 60,
      fontFamily: "Avenir Next",
      bold: true,
      italic: true,
    };
    expect(overlay.setStyle(style)).toBe(true);
    expect(view.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { lines: ["current translation"], style },
    });
  });

  it("saves and restores style across authority instances", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    const authority = new SubtitleStyleAuthority(preferences.read().style);
    const pending = authority.beginCommit("font-1", "fontFamily", "Avenir Next");
    expect(pending.outcome).toBe("pending");
    if (pending.outcome !== "pending") throw new Error("expected pending style");
    preferences.save(pending.candidateStyle);
    authority.commit(pending.intent);
    const restored = new SubtitleStyleAuthority(preferences.read().style).snapshot();
    expect(restored.liveStyle.fontFamily).toBe("Avenir Next");
  });

  it("caches style without creating text when no translation is active", () => {
    const { view, overlay } = readyOverlay();
    const renderCount = view.messages.filter((message) => message.name === "overlay:render").length;
    expect(overlay.setStyle({ ...DEFAULT_SUBTITLE_TEXT_STYLE, fontSize: 55 })).toBe(true);
    expect(view.messages.filter((message) => message.name === "overlay:render")).toHaveLength(
      renderCount,
    );
    overlay.show(["next real translation"]);
    expect(view.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { lines: ["next real translation"], style: { fontSize: 55 } },
    });
  });

  it("temporarily falls back and restores a preferred font without changing preferences", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    const preferred = { ...DEFAULT_SUBTITLE_TEXT_STYLE, fontFamily: "Example Family" };
    preferences.save(preferred);
    const { view, overlay } = readyOverlay();
    overlay.show(["current translation"]);
    overlay.setStyle({ ...preferred, fontFamily: null });
    expect(view.messages.at(-1)).toMatchObject({ data: { style: { fontFamily: null } } });
    overlay.setStyle(preferred);
    expect(view.messages.at(-1)).toMatchObject({
      data: { style: { fontFamily: "Example Family" } },
    });
    expect(preferences.read().style.fontFamily).toBe("Example Family");
  });

  it("previews Border and Background immediately while preserving Position", () => {
    const { view, overlay } = readyOverlay();
    overlay.setPosition(73);
    overlay.show(["first line", "second line"]);
    const style = {
      ...DEFAULT_SUBTITLE_TEXT_STYLE,
      borderColor: { r: 10, g: 20, b: 30, a: 128 },
      borderWidth: 0,
      backgroundColor: { r: 40, g: 50, b: 60, a: 96 },
    };
    expect(overlay.setStyle(style)).toBe(true);
    expect(view.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { position: 73, lines: ["first line", "second line"], style },
    });
  });

  it("keeps the upgraded default baseline and transparent combinations exact", () => {
    expect(DEFAULT_SUBTITLE_TEXT_STYLE).toMatchObject({
      borderColor: { r: 0, g: 0, b: 0, a: 255 },
      borderWidth: 3,
      backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
    });
    const { view, overlay } = readyOverlay();
    overlay.show(["current translation"]);
    overlay.setStyle({
      ...DEFAULT_SUBTITLE_TEXT_STYLE,
      fontColor: { r: 1, g: 2, b: 3, a: 0 },
      borderColor: { r: 4, g: 5, b: 6, a: 0 },
      borderWidth: 0,
      backgroundColor: { r: 7, g: 8, b: 9, a: 0 },
    });
    expect(view.messages.at(-1)).toMatchObject({
      data: {
        style: {
          fontColor: { r: 1, g: 2, b: 3, a: 0 },
          borderColor: { r: 4, g: 5, b: 6, a: 0 },
          borderWidth: 0,
          backgroundColor: { r: 7, g: 8, b: 9, a: 0 },
        },
      },
    });
  });

  it("caches Border and Background changes without creating text", () => {
    const { view, overlay } = readyOverlay();
    const renderCount = view.messages.filter((message) => message.name === "overlay:render").length;
    overlay.setStyle({
      ...DEFAULT_SUBTITLE_TEXT_STYLE,
      borderWidth: 5,
      backgroundColor: { r: 20, g: 30, b: 40, a: 128 },
    });
    expect(view.messages.filter((message) => message.name === "overlay:render")).toHaveLength(
      renderCount,
    );
  });

  it("merges interleaved different-window fields and keeps the latest same-field intent", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    const font = authority.beginCommit("window-a-font", "fontSize", 55);
    expect(font.outcome).toBe("pending");
    if (font.outcome !== "pending") throw new Error("expected font intent");
    authority.commit(font.intent);
    const border = authority.beginCommit("window-b-border", "borderWidth", 5);
    expect(border.outcome).toBe("pending");
    if (border.outcome !== "pending") throw new Error("expected border intent");
    authority.commit(border.intent);
    authority.preview("old-panel", "fontColor", { r: 1, g: 1, b: 1, a: 255 });
    authority.preview("new-panel", "fontColor", { r: 2, g: 2, b: 2, a: 128 });
    expect(
      authority.beginCommit("old-panel", "fontColor", { r: 1, g: 1, b: 1, a: 255 }).outcome,
    ).toBe("superseded");
    const latest = authority.beginCommit("new-panel", "fontColor", {
      r: 2,
      g: 2,
      b: 2,
      a: 128,
    });
    expect(latest.outcome).toBe("pending");
    if (latest.outcome !== "pending") throw new Error("expected latest color intent");
    expect(authority.commit(latest.intent).state.committedStyle).toMatchObject({
      fontSize: 55,
      borderWidth: 5,
      fontColor: { r: 2, g: 2, b: 2, a: 128 },
    });
  });

  it("restores all eight fields after a picker-backed save failure", () => {
    const authority = new SubtitleStyleAuthority(DEFAULT_SUBTITLE_TEXT_STYLE);
    authority.preview("panel-color", "backgroundColor", { r: 10, g: 20, b: 30, a: 128 });
    authority.preview("other-window", "italic", true);
    const pending = authority.beginCommit("panel-color", "backgroundColor", {
      r: 10,
      g: 20,
      b: 30,
      a: 128,
    });
    expect(pending.outcome).toBe("pending");
    if (pending.outcome !== "pending") throw new Error("expected color intent");
    const failed = authority.fail(pending.intent);
    expect(failed.state.liveStyle).toEqual(DEFAULT_SUBTITLE_TEXT_STYLE);
    expect(failed.state.committedStyle).toEqual(DEFAULT_SUBTITLE_TEXT_STYLE);
    expect(authority.beginCommit("other-window", "italic", true).outcome).toBe("superseded");
  });

  it("restores all eight persisted fields in a new authority and overlay", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    const saved = {
      ...DEFAULT_SUBTITLE_TEXT_STYLE,
      fontColor: { r: 1, g: 2, b: 3, a: 4 },
      fontSize: 70,
      fontFamily: "Avenir Next",
      bold: true,
      italic: true,
      borderColor: { r: 5, g: 6, b: 7, a: 8 },
      borderWidth: 5,
      backgroundColor: { r: 9, g: 10, b: 11, a: 12 },
    };
    preferences.save(saved);
    const restored = new SubtitleStyleAuthority(preferences.read().style).snapshot();
    expect(restored.liveStyle).toEqual(saved);
    const { view, overlay } = readyOverlay();
    overlay.setStyle(restored.liveStyle);
    overlay.show(["new window"]);
    expect(view.messages.at(-1)).toMatchObject({ data: { style: saved } });
  });
});

describe("localized native sessions through real Main and Global", () => {
  it.each(UI_LOCALES)(
    "keeps %s fixed across multiwindow open, preview, confirm, cancel and close",
    async (locale) => {
      vi.useFakeTimers();
      try {
        const runtime = await uiLanguageRuntime({ nativePicker: true });
        const first = await runtime.addWindow({ preferred: [locale] });
        const second = await runtime.addWindow({ preferred: [locale === "he" ? "en" : "he"] });
        const open = (window: typeof first, requestId: string, kind: string, field: string) =>
          window.send("subtitle-style:picker-open", {
            requestId,
            revision: 1,
            payload: { kind, field },
          });
        const result = (window: typeof first, requestId: string) => {
          window.poll();
          return window.messages
            .filter(
              (entry) =>
                entry.name === "subtitle-style:picker-result" && entry.data.requestId === requestId,
            )
            .at(-1)?.data;
        };
        open(first, "font-first", "font", "fontFamily");
        await runtime.pump();
        expect(runtime.exec).toHaveBeenCalledTimes(1);
        expect(runtime.exec.mock.calls[0]![1].slice(3)).toEqual([
          "--ui-locale",
          locale,
          "-AppleLanguages",
          `(${locale})`,
        ]);
        open(second, "font-second", "font", "fontFamily");
        await runtime.pump();
        expect(result(second, "font-second")).toMatchObject({ outcome: "focused" });
        runtime.nativeEvent({
          requestId: "font-first",
          type: "font-confirmed",
          fontFamily: "Avenir Next",
        });
        await runtime.pump();
        expect(result(first, "font-first")).toMatchObject({ outcome: "confirmed" });
        expect(
          runtime.preferences.set.mock.calls.some(
            ([key, value]) =>
              key === "translationSubtitleTextStyle" &&
              JSON.stringify(value).includes("Avenir Next"),
          ),
        ).toBe(true);
        const color = { r: 12, g: 34, b: 56, a: 128 };
        open(second, "color-second", "color", "fontColor");
        await runtime.pump();
        runtime.nativeEvent({ requestId: "color-second", type: "color-preview", color });
        await runtime.pump();
        second.poll();
        expect(
          second.messages.filter((entry) => entry.name === "subtitle-style:state").at(-1)?.data
            .liveStyle.fontColor,
        ).toEqual(color);
        second.close();
        await runtime.pump();
        expect(runtime.network.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(true);
        runtime.nativeEvent({
          requestId: "color-second",
          type: "color-closed",
          changed: true,
          color,
        });
        await runtime.pump();
        expect(
          runtime.preferences.set.mock.calls.filter(
            ([key, value]) =>
              key === "translationSubtitleTextStyle" && JSON.stringify(value).includes('"r":12'),
          ),
        ).toHaveLength(0);
        open(first, "font-cancel", "font", "fontFamily");
        await runtime.pump();
        runtime.nativeEvent({ requestId: "font-cancel", type: "font-cancelled" });
        await runtime.pump();
        expect(result(first, "font-cancel")).toMatchObject({ outcome: "cancelled" });
        expect(runtime.exec).toHaveBeenCalledTimes(1);
        expect(
          runtime.network.mock.calls.every(
            ([, request]) => !Object.hasOwn(request.data, "uiLocale"),
          ),
        ).toBe(true);
        first.close();
        await runtime.pump();
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.doUnmock("../../src/runtime/providers/profile-activation.js");
      }
    },
  );
  it("starts fault-resolved English and rejects invalid native ready locale", async () => {
    vi.useFakeTimers();
    try {
      const runtime = await uiLanguageRuntime({ nativePicker: true, badReadyLocale: true });
      const window = await runtime.addWindow({ version: "1.4.9", preferred: ["he"] });
      window.send("subtitle-style:picker-open", {
        requestId: "bad-ready",
        revision: 1,
        payload: { kind: "font", field: "fontFamily" },
      });
      await runtime.pump();
      expect(runtime.exec.mock.calls[0]![1].slice(3)).toEqual([
        "--ui-locale",
        "en",
        "-AppleLanguages",
        "(en)",
      ]);
      window.poll();
      expect(
        window.messages.filter((entry) => entry.name === "subtitle-style:picker-result").at(-1)
          ?.data.outcome,
      ).toBe("failed");
      expect(runtime.network).not.toHaveBeenCalled();
      window.close();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.doUnmock("../../src/runtime/providers/profile-activation.js");
    }
  });
});

describe("native session authority invalidation", () => {
  it("cancels the old native interaction before accepting the replacement language authority", async () => {
    vi.useFakeTimers();
    try {
      const runtime = await uiLanguageRuntime({ nativePicker: true });
      const window = await runtime.addWindow({ preferred: ["he"] });
      window.send("subtitle-style:picker-open", {
        requestId: "old-authority-font",
        revision: 1,
        payload: { kind: "font", field: "fontFamily" },
      });
      await runtime.pump();
      runtime.dropResponse("profile-activation:state", true);
      runtime.dropLanguage(true);
      window.reload();
      await runtime.pump();
      const request = [...runtime.frames]
        .reverse()
        .find((frame) => frame.frame.name === "profile-activation:get")!.frame.data;
      runtime.injectResponse("profile-activation:state", {
        requestId: request.requestId,
        authority: {
          ...window.state.profileAuthority,
          authorityId: "replacement-authority",
          stateVersion: 1,
        },
      });
      await runtime.pump();
      expect(
        runtime.network.mock.calls.some(
          ([url, request]) =>
            url.endsWith("/cancel") && request.data.requestId === "old-authority-font",
        ),
      ).toBe(true);
      runtime.nativeEvent({
        requestId: "old-authority-font",
        type: "font-confirmed",
        fontFamily: "Expired Family",
      });
      await runtime.pump();
      expect(
        runtime.preferences.set.mock.calls.some(([, value]) =>
          JSON.stringify(value).includes("Expired Family"),
        ),
      ).toBe(false);
      window.close();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.doUnmock("../../src/runtime/providers/profile-activation.js");
    }
  });
});
