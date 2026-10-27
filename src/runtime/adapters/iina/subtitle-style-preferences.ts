import {
  cloneSubtitleTextStyle,
  isSubtitleTextStyle,
  normalizeSubtitleTextStyle,
  type SubtitleTextStyle,
} from "../../domain/subtitle-style.js";

export interface SubtitleStylePreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  sync(): void;
}

export class SubtitleStylePreferenceError extends Error {
  constructor(readonly code: "INVALID_SUBTITLE_STYLE" | "SUBTITLE_STYLE_SAVE_FAILED") {
    super(code);
    this.name = "SubtitleStylePreferenceError";
  }
}

export class SubtitleStylePreferences {
  static readonly key = "translationSubtitleTextStyle";

  constructor(private readonly store: SubtitleStylePreferenceStore) {}

  read(): { style: SubtitleTextStyle; source: "saved" | "recovered" | "default" } {
    const raw = this.store.get(SubtitleStylePreferences.key);
    if (typeof raw !== "string")
      return { style: normalizeSubtitleTextStyle(null), source: "default" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { style: normalizeSubtitleTextStyle(null), source: "default" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { style: normalizeSubtitleTextStyle(null), source: "default" };
    return {
      style: normalizeSubtitleTextStyle(parsed),
      source: isSubtitleTextStyle(parsed) ? "saved" : "recovered",
    };
  }

  save(style: SubtitleTextStyle): void {
    if (!isSubtitleTextStyle(style))
      throw new SubtitleStylePreferenceError("INVALID_SUBTITLE_STYLE");
    const previous = this.store.get(SubtitleStylePreferences.key);
    try {
      this.store.set(SubtitleStylePreferences.key, JSON.stringify(cloneSubtitleTextStyle(style)));
      this.store.sync();
    } catch {
      try {
        this.store.set(SubtitleStylePreferences.key, previous === undefined ? "" : previous);
        this.store.sync();
      } catch (rollbackError) {
        void rollbackError;
      }
      throw new SubtitleStylePreferenceError("SUBTITLE_STYLE_SAVE_FAILED");
    }
  }
}
