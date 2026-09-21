import { describe, expect, it } from "vitest";
import { TranslationEnabledPreferences } from "../../src/adapters/iina/translation-enabled-preferences.js";

class Store {
  readonly values = new Map<string, unknown>();
  readonly calls: string[] = [];

  get(key: string): unknown {
    this.calls.push(`get:${key}`);
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.calls.push(`set:${key}:${String(value)}`);
    this.values.set(key, value);
  }

  sync(): void {
    this.calls.push("sync");
  }
}

describe("translation enabled preferences", () => {
  it("restores only explicit booleans and defaults missing or invalid values to off", () => {
    const store = new Store();
    const preferences = new TranslationEnabledPreferences(store);

    expect(preferences.read()).toBe(false);
    for (const invalid of [null, "true", 1, {}, []]) {
      store.values.set("enabledByDefault", invalid);
      expect(preferences.read()).toBe(false);
    }
    store.values.set("enabledByDefault", false);
    expect(new TranslationEnabledPreferences(store).read()).toBe(false);
    store.values.set("enabledByDefault", true);
    expect(new TranslationEnabledPreferences(store).read()).toBe(true);
  });

  it("persists each explicit value and synchronizes it before returning", () => {
    const store = new Store();
    const preferences = new TranslationEnabledPreferences(store);

    preferences.save(true);
    preferences.save(false);

    expect(store.calls).toEqual([
      "set:enabledByDefault:true",
      "sync",
      "set:enabledByDefault:false",
      "sync",
    ]);
    expect(new TranslationEnabledPreferences(store).read()).toBe(false);
  });
});
