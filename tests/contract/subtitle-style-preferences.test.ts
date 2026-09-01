import { describe, expect, it } from "vitest";
import {
  SubtitleStylePreferenceError,
  SubtitleStylePreferences,
} from "../../src/adapters/iina/subtitle-style-preferences.js";
import { DEFAULT_SUBTITLE_TEXT_STYLE } from "../../src/domain/subtitle-style.js";
import { FakeIinaPreferences } from "../helpers/fake-iina.js";

describe("subtitle style preferences", () => {
  it("reads one JSON preference and recovers fields independently", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    expect(preferences.read()).toEqual({ style: DEFAULT_SUBTITLE_TEXT_STYLE, source: "default" });
    expect(store.writes).toEqual([]);

    store.values.set(
      SubtitleStylePreferences.key,
      JSON.stringify({
        ...DEFAULT_SUBTITLE_TEXT_STYLE,
        fontColor: { r: 10, g: 20, b: 30, a: 40 },
        fontSize: 42,
        bold: true,
      }),
    );
    expect(preferences.read()).toEqual({
      source: "recovered",
      style: {
        ...DEFAULT_SUBTITLE_TEXT_STYLE,
        fontColor: { r: 10, g: 20, b: 30, a: 40 },
        bold: true,
      },
    });
    expect(store.writes).toEqual([]);
  });

  it("uses the whole default for malformed JSON and invalid roots", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    for (const raw of ["{", "null", "[]", "42", true]) {
      store.values.set(SubtitleStylePreferences.key, raw);
      expect(preferences.read()).toEqual({ style: DEFAULT_SUBTITLE_TEXT_STYLE, source: "default" });
    }
    expect(store.writes).toEqual([]);
  });

  it("persists all eight fields with one set and one sync", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    const style = { ...DEFAULT_SUBTITLE_TEXT_STYLE, bold: true, fontFamily: "Inter" };
    preferences.save(style);
    expect(store.writes).toHaveLength(1);
    expect(store.syncCount).toBe(1);
    expect(JSON.parse(String(store.values.get(SubtitleStylePreferences.key)))).toEqual(style);
  });

  it("restores the prior raw value after set or sync failure", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    const raw = JSON.stringify({ ...DEFAULT_SUBTITLE_TEXT_STYLE, italic: true });
    store.values.set(SubtitleStylePreferences.key, raw);
    store.failNextSync = true;
    expect(() => preferences.save({ ...DEFAULT_SUBTITLE_TEXT_STYLE, bold: true })).toThrow(
      SubtitleStylePreferenceError,
    );
    expect(store.values.get(SubtitleStylePreferences.key)).toBe(raw);

    store.values.delete(SubtitleStylePreferences.key);
    store.failNextSet = true;
    expect(() => preferences.save({ ...DEFAULT_SUBTITLE_TEXT_STYLE, bold: true })).toThrow(
      "SUBTITLE_STYLE_SAVE_FAILED",
    );
    expect(store.values.get(SubtitleStylePreferences.key)).toBe("");
  });

  it("rejects invalid styles with a fixed safe error", () => {
    const store = new FakeIinaPreferences();
    const preferences = new SubtitleStylePreferences(store);
    expect(() =>
      preferences.save({ ...DEFAULT_SUBTITLE_TEXT_STYLE, fontFamily: "subtitle body\u0000" }),
    ).toThrow("INVALID_SUBTITLE_STYLE");
    expect(store.writes).toEqual([]);
  });
});
