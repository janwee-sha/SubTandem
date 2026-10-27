import { describe, expect, it, vi } from "vitest";
import { sampleHostUiContext } from "../../src/runtime/adapters/iina/host-ui-context.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";

describe("host UI sampling", () => {
  it("contains a throwing language API property", () => {
    const utils = Object.defineProperty({}, "preferredLocalizations", {
      get() {
        throw new Error("private");
      },
    });
    expect(sampleHostUiContext({ core: { getVersion: () => ({ iina: "1.5.0" }) }, utils })).toEqual(
      { hostVersion: "1.5.0", preferredLocalization: null, failure: "readFailed" },
    );
  });
  it.each(["1.4.0", "1.4.99", "unknown", "1.5.0-beta", "1.5", "01.5.0"])(
    "does not read languages for %s",
    (version) => {
      const preferredLocalizations = vi.fn(() => ["de"]);
      const sample = sampleHostUiContext({
        core: { getVersion: () => ({ iina: version }) },
        utils: { preferredLocalizations },
      });
      expect(sample.failure).toBe(version.startsWith("1.4.") ? "legacyHost" : "unknownVersion");
      expect(preferredLocalizations).not.toHaveBeenCalled();
    },
  );
  it.each(["1.5.0", "1.10.0", "2.0.0"])("compares version %s numerically", (iina) => {
    expect(
      sampleHostUiContext({
        core: { getVersion: () => ({ iina }) },
        utils: { preferredLocalizations: () => ["de", "en"] },
      }),
    ).toEqual({ hostVersion: iina, preferredLocalization: "de", failure: null });
  });
  it.each(UI_LOCALES)("retains only the first raw %s localization", (locale) => {
    expect(
      sampleHostUiContext({
        core: { getVersion: () => ({ iina: "1.5.0" }) },
        utils: { preferredLocalizations: () => [locale, "en"] },
      }).preferredLocalization,
    ).toBe(locale);
  });
  it.each([
    [undefined, "unavailable"],
    [
      () => {
        throw new Error("private");
      },
      "readFailed",
    ],
    [() => [], "emptyResult"],
    [() => "de", "invalidResult"],
    [() => [""], "invalidResult"],
    [() => [{}, "de"], "invalidResult"],
  ] as const)("reports sampling failure", (read, failure) => {
    expect(
      sampleHostUiContext({
        core: { getVersion: () => ({ iina: "1.5.0" }) },
        utils: read ? { preferredLocalizations: read } : {},
      }).failure,
    ).toBe(failure);
  });
});
