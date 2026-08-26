import { describe, expect, it } from "vitest";
import { TargetLanguageSession } from "../../src/app/target-language-session.js";

describe("target language session commit point", () => {
  it("keeps the committed target until a matching Global success arrives", () => {
    const session = new TargetLanguageSession("en");
    expect(session.begin({ requestId: "a", revision: 1, targetLanguage: "ja" })).toBe(true);
    expect(session.snapshot).toMatchObject({ targetLanguage: "en", revision: 1 });
    expect(session.commit({ requestId: "late", targetLanguage: "ja" })).toBeNull();
    expect(session.commit({ requestId: "a", targetLanguage: "ko" })).toBeNull();
    expect(session.commit({ requestId: "a", targetLanguage: "ja" })).toEqual({
      targetLanguage: "ja",
      revision: 2,
    });
  });

  it("allows one pending save and preserves the old context on failure", () => {
    const session = new TargetLanguageSession("pt");
    expect(session.begin({ requestId: "a", revision: 1, targetLanguage: "pt-PT" })).toBe(true);
    expect(session.begin({ requestId: "b", revision: 1, targetLanguage: "en" })).toBe(false);
    expect(session.fail("unknown")).toBe(false);
    expect(session.fail("a")).toBe(true);
    expect(session.snapshot).toEqual({ targetLanguage: "pt", revision: 1 });
    expect(session.begin({ requestId: "b", revision: 1, targetLanguage: "en" })).toBe(true);
  });
});
