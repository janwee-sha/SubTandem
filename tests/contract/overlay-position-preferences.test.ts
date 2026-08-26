import { describe, expect, it } from "vitest";
import {
  OverlayPositionPreferenceError,
  OverlayPositionPreferences,
} from "../../src/adapters/iina/overlay-position-preferences.js";
import { FakeIinaPreferences } from "../helpers/fake-iina.js";

describe("overlay position preferences", () => {
  it("uses a non-persistent default for missing and invalid values", () => {
    const store = new FakeIinaPreferences();
    const preferences = new OverlayPositionPreferences(store);
    for (const value of [undefined, -1, 101, 1.5, "42", null]) {
      if (value === undefined) store.values.delete("translationOverlayPosition");
      else store.values.set("translationOverlayPosition", value);
      expect(preferences.read()).toEqual({ position: 0, source: "default" });
    }
    expect(store.writes).toEqual([]);
    store.values.set("translationOverlayPosition", 42);
    expect(preferences.read()).toEqual({ position: 42, source: "saved" });
  });

  it("persists only valid integers", () => {
    const store = new FakeIinaPreferences();
    const preferences = new OverlayPositionPreferences(store);
    preferences.save(100);
    expect(store.values.get("translationOverlayPosition")).toBe(100);
    expect(store.syncCount).toBe(1);
    for (const value of [-1, 101, 2.5, Number.NaN]) {
      expect(() => preferences.save(value)).toThrow(OverlayPositionPreferenceError);
    }
  });

  it("restores the prior property-list-safe value after set or sync failure", () => {
    const store = new FakeIinaPreferences();
    store.values.set("translationOverlayPosition", 25);
    const preferences = new OverlayPositionPreferences(store);
    store.failNextSync = true;
    expect(() => preferences.save(50)).toThrow("OVERLAY_POSITION_SAVE_FAILED");
    expect(store.values.get("translationOverlayPosition")).toBe(25);

    store.values.delete("translationOverlayPosition");
    store.failNextSet = true;
    expect(() => preferences.save(75)).toThrow("OVERLAY_POSITION_SAVE_FAILED");
    expect(store.values.get("translationOverlayPosition")).toBe("");
    expect(preferences.read()).toEqual({ position: 0, source: "default" });
  });
});
