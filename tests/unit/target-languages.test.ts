import baseline from "../fixtures/localization/business-values.json";
import { describe, expect, it } from "vitest";
import {
  getProviderLanguageLabel,
  getTargetLanguage,
  isTargetLanguageId,
  TARGET_LANGUAGES,
} from "../../src/domain/target-languages.js";

describe("target language catalog", () => {
  it("contains the exact 156-item business identity set without a display order", () => {
    expect(TARGET_LANGUAGES).toHaveLength(156);
    expect(TARGET_LANGUAGES).toEqual(baseline.targetLanguages);
    expect(
      TARGET_LANGUAGES.every(
        (item) => !("displayName" in item) && !("order" in item) && !("detectorCode" in item),
      ),
    ).toBe(true);
    for (const field of ["id", "requestName", "providerLabel"] as const)
      expect(new Set(TARGET_LANGUAGES.map((item) => item[field])).size).toBe(156);
  });

  it("keeps explicit variants and named edge identities distinct", () => {
    expect(getTargetLanguage("zh-Hans")).toMatchObject({ equivalence: "exact-script" });
    expect(getTargetLanguage("zh-Hant")).toMatchObject({ equivalence: "exact-script" });
    expect(getTargetLanguage("pt")).toMatchObject({ equivalence: "base" });
    expect(getTargetLanguage("pt-PT")).toMatchObject({ equivalence: "exact-region" });
    expect(getTargetLanguage("gaa")?.requestName).toBe("Ga");
    expect(getTargetLanguage("kri")?.requestName).toBe("Krio");
  });

  it("validates members and derives stable provider labels", () => {
    expect(isTargetLanguageId("fil")).toBe(true);
    expect(isTargetLanguageId("tl")).toBe(false);
    expect(getProviderLanguageLabel("pt-PT")).toBe("Portuguese (Portugal) [pt-PT]");
  });
});
