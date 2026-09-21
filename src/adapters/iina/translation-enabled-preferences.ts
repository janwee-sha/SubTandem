export interface TranslationEnabledPreferenceStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  sync(): void;
}

export class TranslationEnabledPreferences {
  constructor(private readonly store: TranslationEnabledPreferenceStore) {}

  read(): boolean {
    return this.store.get("enabledByDefault") === true;
  }

  save(enabled: boolean): void {
    this.store.set("enabledByDefault", enabled);
    this.store.sync();
  }
}
