export interface PreferencePort {
  get(key: string): unknown;
  set(key: string, value: string | number | boolean | null): void;
}

export function readStringPreference(port: PreferencePort | undefined, key: string): string | null {
  const value = port?.get(key);
  return typeof value === "string" ? value : null;
}

export function readBooleanPreference(
  port: PreferencePort | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = port?.get(key);
  return typeof value === "boolean" ? value : fallback;
}

export function withFileHandle<T>(
  handle: IINA.API.FileHandle | null | undefined,
  operation: (handle: IINA.API.FileHandle) => T,
): T | null {
  if (!handle) return null;
  try {
    return operation(handle);
  } finally {
    handle.close();
  }
}

export function finitePosition(position: unknown): number | null {
  return typeof position === "number" && Number.isFinite(position) && position >= 0
    ? position
    : null;
}
