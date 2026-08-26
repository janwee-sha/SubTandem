import { describe, expect, it } from "vitest";
import {
  TargetLanguagePreferences,
  TargetLanguagePreferenceError,
} from "../../src/adapters/iina/target-language-preferences.js";

class Store {
  values = new Map<string, unknown>();
  failSet = false;
  failSync = false;
  rejectNull = false;
  syncFailures = 0;

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    if (this.failSet) throw new Error("private set detail");
    this.values.set(key, value);
  }

  sync(): void {
    if (this.syncFailures > 0) {
      this.syncFailures -= 1;
      throw new Error("private sync detail");
    }
    if (this.failSync) throw new Error("private sync detail");
    if (this.rejectNull && [...this.values.values()].includes(null))
      throw new Error("invalid property list value");
  }
}

describe("target language preferences", () => {
  it("restores valid values and uses an in-memory default for missing or invalid values", () => {
    const store = new Store();
    const preferences = new TargetLanguagePreferences(store);
    expect(preferences.read()).toEqual({ targetLanguage: "zh-Hans", source: "default" });
    expect(store.values.has("targetLanguage")).toBe(false);
    store.values.set("targetLanguage", "pt-PT");
    expect(preferences.read()).toEqual({ targetLanguage: "pt-PT", source: "saved" });
    store.values.set("targetLanguage", "made-up");
    expect(preferences.read()).toEqual({ targetLanguage: "zh-Hans", source: "default" });
  });

  it("validates catalog membership before set and sync", () => {
    const store = new Store();
    const preferences = new TargetLanguagePreferences(store);
    expect(() => preferences.save("tl")).toThrowError(TargetLanguagePreferenceError);
    expect(store.values.has("targetLanguage")).toBe(false);
  });

  it("rolls back the previous value and missing state after set or sync failure", () => {
    const store = new Store();
    store.values.set("targetLanguage", "en");
    const preferences = new TargetLanguagePreferences(store);
    store.failSync = true;
    expect(() => preferences.save("ja")).toThrowError(/TARGET_LANGUAGE_SAVE_FAILED/);
    expect(store.values.get("targetLanguage")).toBe("en");
    store.failSync = false;
    store.values.delete("targetLanguage");
    store.failSet = true;
    expect(() => preferences.save("ja")).toThrowError(/TARGET_LANGUAGE_SAVE_FAILED/);
    expect(store.values.has("targetLanguage")).toBe(false);
  });

  it("persists only targetLanguage on success", () => {
    const store = new Store();
    new TargetLanguagePreferences(store).save("kri");
    expect(Object.fromEntries(store.values)).toEqual({ targetLanguage: "kri" });
  });

  it("keeps legacy cleanup property-list safe so a saved target survives restart", () => {
    const store = new Store();
    store.rejectNull = true;
    store.values.set("targetLanguage", "ko");
    store.values.set("sourceLanguage", "ja");
    store.values.set("sourceLanguageMode", "manual");
    const preferences = new TargetLanguagePreferences(store);

    preferences.clearLegacySourcePreferences();
    preferences.save("pt-PT");

    expect(store.values.get("sourceLanguage")).toBe("");
    expect(store.values.get("sourceLanguageMode")).toBe("");
    expect(new TargetLanguagePreferences(store).read()).toEqual({
      targetLanguage: "pt-PT",
      source: "saved",
    });
  });

  it("uses a property-list-safe missing sentinel when rollback cannot delete a key", () => {
    const store = new Store();
    store.rejectNull = true;
    store.syncFailures = 1;
    const preferences = new TargetLanguagePreferences(store);

    expect(() => preferences.save("ja")).toThrowError(/TARGET_LANGUAGE_SAVE_FAILED/);
    expect(store.values.get("targetLanguage")).toBe("");
    expect(preferences.read()).toEqual({ targetLanguage: "zh-Hans", source: "default" });
  });
});
