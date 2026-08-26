import { isTargetLanguageId } from "../../domain/target-languages.js";

export interface TargetLanguagePreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  sync(): void;
}

export class TargetLanguagePreferenceError extends Error {
  constructor(readonly code: "INVALID_TARGET_LANGUAGE" | "TARGET_LANGUAGE_SAVE_FAILED") {
    super(code);
    this.name = "TargetLanguagePreferenceError";
  }
}

export class TargetLanguagePreferences {
  constructor(private readonly store: TargetLanguagePreferenceStore) {}

  clearLegacySourcePreferences(): void {
    this.store.set("sourceLanguage", "");
    this.store.set("sourceLanguageMode", "");
    this.store.sync();
  }

  read(): { targetLanguage: string; source: "saved" | "default" } {
    const value = this.store.get("targetLanguage");
    return isTargetLanguageId(value)
      ? { targetLanguage: value, source: "saved" }
      : { targetLanguage: "zh-Hans", source: "default" };
  }

  save(targetLanguage: string): void {
    if (!isTargetLanguageId(targetLanguage))
      throw new TargetLanguagePreferenceError("INVALID_TARGET_LANGUAGE");
    const previous = this.store.get("targetLanguage");
    try {
      this.store.set("targetLanguage", targetLanguage);
      this.store.sync();
    } catch {
      try {
        this.store.set("targetLanguage", previous == null ? "" : previous);
        this.store.sync();
      } catch (rollbackError) {
        void rollbackError;
      }
      throw new TargetLanguagePreferenceError("TARGET_LANGUAGE_SAVE_FAILED");
    }
  }
}
