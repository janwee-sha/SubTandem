import { describe, expect, it } from "vitest";
import { normalizeLanguageTag, shouldTranslate } from "../../src/domain/language.js";

describe("language identity", () => {
  it("normalizes legacy aliases and Chinese regional forms", () => {
    expect(normalizeLanguageTag("iw_IL")).toBe("he-IL");
    expect(normalizeLanguageTag("in-ID")).toBe("id-ID");
    expect(normalizeLanguageTag("ji")).toBe("yi");
    expect(normalizeLanguageTag("zh-CN")).toBe("zh-Hans");
    expect(normalizeLanguageTag("zh-HK")).toBe("zh-Hant");
  });

  it("uses generic target, explicit script and explicit region equivalence", () => {
    expect(shouldTranslate("en-US", "en")).toBe(false);
    expect(shouldTranslate("pt-BR", "pt")).toBe(false);
    expect(shouldTranslate("pt-BR", "pt-PT")).toBe(true);
    expect(shouldTranslate("pt-PT", "pt-PT")).toBe(false);
    expect(shouldTranslate("zh-CN", "zh-Hans")).toBe(false);
    expect(shouldTranslate("zh-TW", "zh-Hant")).toBe(false);
    expect(shouldTranslate("zh-Hans", "zh-Hant")).toBe(true);
    expect(shouldTranslate("zh-Hant", "zh-Hans")).toBe(true);
    expect(shouldTranslate("zh", "zh-Hans")).toBe(true);
  });

  it("fails closed for invalid language identities", () => {
    expect(normalizeLanguageTag("und")).toBeNull();
    expect(normalizeLanguageTag("english")).toBeNull();
    expect(shouldTranslate("invalid", "en")).toBe(false);
  });
});
