import { DEFAULT_OVERLAY_POSITION, isOverlayPosition } from "../../domain/overlay-position.js";

export interface OverlayPositionPreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  sync(): void;
}

export class OverlayPositionPreferenceError extends Error {
  constructor(readonly code: "INVALID_OVERLAY_POSITION" | "OVERLAY_POSITION_SAVE_FAILED") {
    super(code);
    this.name = "OverlayPositionPreferenceError";
  }
}

export class OverlayPositionPreferences {
  static readonly key = "translationOverlayPosition";

  constructor(private readonly store: OverlayPositionPreferenceStore) {}

  read(): { position: number; source: "saved" | "default" } {
    const value = this.store.get(OverlayPositionPreferences.key);
    return isOverlayPosition(value)
      ? { position: value, source: "saved" }
      : { position: DEFAULT_OVERLAY_POSITION, source: "default" };
  }

  save(position: number): void {
    if (!isOverlayPosition(position))
      throw new OverlayPositionPreferenceError("INVALID_OVERLAY_POSITION");
    const previous = this.store.get(OverlayPositionPreferences.key);
    try {
      this.store.set(OverlayPositionPreferences.key, position);
      this.store.sync();
    } catch {
      try {
        this.store.set(OverlayPositionPreferences.key, previous === undefined ? "" : previous);
        this.store.sync();
      } catch (rollbackError) {
        void rollbackError;
      }
      throw new OverlayPositionPreferenceError("OVERLAY_POSITION_SAVE_FAILED");
    }
  }
}
