import type { HostUiSample } from "../../../shared/localization/types.js";

export interface HostUiRuntime {
  core?: { getVersion?: () => unknown };
  utils?: { preferredLocalizations?: () => unknown };
}

export function hostVersionParts(value: unknown): readonly number[] | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    return null;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function supportsHostUiLanguage(version: string): boolean {
  const parts = hostVersionParts(version);
  return parts !== null && (parts[0]! > 1 || (parts[0] === 1 && parts[1]! >= 5));
}

export function validHostLocalization(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(value)
  );
}

export function sampleHostUiContext(runtime: HostUiRuntime): HostUiSample {
  let version: unknown;
  try {
    const result = runtime.core?.getVersion?.();
    version =
      result !== null && typeof result === "object" && !Array.isArray(result)
        ? (result as { iina?: unknown }).iina
        : null;
  } catch {
    version = null;
  }
  if (!hostVersionParts(version))
    return { hostVersion: null, preferredLocalization: null, failure: "unknownVersion" };
  const hostVersion = version as string;
  if (!supportsHostUiLanguage(hostVersion))
    return { hostVersion, preferredLocalization: null, failure: "legacyHost" };
  let result: unknown;
  try {
    const read = runtime.utils?.preferredLocalizations;
    if (typeof read !== "function")
      return { hostVersion, preferredLocalization: null, failure: "unavailable" };
    result = read.call(runtime.utils);
  } catch {
    return { hostVersion, preferredLocalization: null, failure: "readFailed" };
  }
  if (!Array.isArray(result))
    return { hostVersion, preferredLocalization: null, failure: "invalidResult" };
  if (result.length === 0)
    return { hostVersion, preferredLocalization: null, failure: "emptyResult" };
  if (!validHostLocalization(result[0]))
    return { hostVersion, preferredLocalization: null, failure: "invalidResult" };
  return { hostVersion, preferredLocalization: result[0], failure: null };
}
