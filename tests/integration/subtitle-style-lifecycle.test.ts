import { describe, expect, it } from "vitest";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { SubtitleStylePreferences } from "../../src/adapters/iina/subtitle-style-preferences.js";
import { SubtitleStyleAuthority } from "../../src/adapters/iina/subtitle-style-sync.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/domain/subtitle-style.js";
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
