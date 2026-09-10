import { describe, expect, it } from "vitest";
import {
  getDetectorLanguage,
  getProviderLanguageLabel,
  getTargetLanguage,
  isTargetLanguageId,
  TARGET_LANGUAGES,
} from "../../src/domain/target-languages.js";

describe("target language catalog", () => {
  it("contains the exact ordered 156-item identity set", () => {
    expect(TARGET_LANGUAGES).toHaveLength(156);
    expect(TARGET_LANGUAGES.map((item) => item.displayName)).toEqual(
      [...TARGET_LANGUAGES]
        .map((item) => item.displayName)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    expect(TARGET_LANGUAGES.map((item) => item.order)).toEqual(
      Array.from({ length: 156 }, (_, index) => index + 1),
    );
    for (const field of ["id", "displayName", "providerLabel"] as const)
      expect(new Set(TARGET_LANGUAGES.map((item) => item[field])).size).toBe(156);
    expect(TARGET_LANGUAGES[0]).toMatchObject({ id: "ab", displayName: "Abkhazian" });
    expect(TARGET_LANGUAGES.at(-1)).toMatchObject({ id: "zu", displayName: "Zulu" });
  });

  it("keeps explicit variants and named edge identities distinct", () => {
    expect(getTargetLanguage("zh-Hans")).toMatchObject({ detectorCode: "cmn" });
    expect(getTargetLanguage("zh-Hant")).toMatchObject({ detectorCode: "cmn" });
    expect(getTargetLanguage("pt")).toMatchObject({ equivalence: "base" });
    expect(getTargetLanguage("pt-PT")).toMatchObject({ equivalence: "exact-region" });
    expect(getTargetLanguage("gaa")?.displayName).toBe("Ga");
    expect(getTargetLanguage("kri")?.displayName).toBe("Krio");
  });

  it("validates members and derives stable provider and detector mappings", () => {
    expect(isTargetLanguageId("fil")).toBe(true);
    expect(isTargetLanguageId("tl")).toBe(false);
    expect(getProviderLanguageLabel("pt-PT")).toBe("Portuguese (Portugal) [pt-PT]");
    expect(getDetectorLanguage("eng")?.id).toBe("en");
    expect(getDetectorLanguage("por")?.id).toBe("pt");
  });
});
