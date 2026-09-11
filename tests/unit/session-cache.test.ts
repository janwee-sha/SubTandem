import { describe, expect, it } from "vitest";
import { SessionTranslationCache, type CacheIdentity } from "../../src/app/session-cache.js";

const identity: CacheIdentity = {
  sessionId: "session-1",
  sourceContentHash: "source-hash",
  targetLanguage: "zh-Hans",
  providerSemanticFingerprint: "provider-a",
};

describe("session-only translation cache", () => {
  it("isolates source/target/provider identity while reusing backward-seek successes", () => {
    const cache = new SessionTranslationCache("session-1");
    cache.insert(identity, [
      { cueId: "c1", translation: "你好" },
      { cueId: "c2", translation: "" },
    ]);
    expect(cache.get(identity, "c1")).toBe("你好");
    expect(cache.get({ ...identity, targetLanguage: "ja" }, "c1")).toBeUndefined();
    expect(cache.get({ ...identity, sourceContentHash: "other-source" }, "c1")).toBeUndefined();
    expect(
      cache.get({ ...identity, providerSemanticFingerprint: "provider-b" }, "c1"),
    ).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("stores same-language and translated results unchanged while rejecting all-whitespace", () => {
    const cache = new SessionTranslationCache("session-1");
    cache.insert(identity, [
      { cueId: "same", translation: "  Same text.\n\n" },
      { cueId: "translated", translation: "  Translated text.  " },
      { cueId: "blank", translation: " \n\t " },
    ]);

    expect(cache.get(identity, "same")).toBe("  Same text.\n\n");
    expect(cache.get(identity, "translated")).toBe("  Translated text.  ");
    expect(cache.get(identity, "blank")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("is a Map-owned memory resource and clears synchronously on close", () => {
    const cache = new SessionTranslationCache("session-1");
    cache.insert(identity, [{ cueId: "c1", translation: "one" }]);
    expect(JSON.stringify(cache)).not.toContain("one");
    cache.clear();
    expect(cache.size).toBe(0);
    const reopened = new SessionTranslationCache("session-2");
    expect(reopened.get({ ...identity, sessionId: "session-2" }, "c1")).toBeUndefined();
  });
});
