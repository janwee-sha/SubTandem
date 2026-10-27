import { describe, expect, it } from "vitest";
import { createLocalizer } from "../../src/ui/localization.js";
import en from "../../src/shared/localization/catalogs/en.json";
import { MESSAGE_DEFINITIONS } from "../../src/shared/localization/message-definitions.js";
describe("production English formatter", () => {
  it("has every definition and a complete target and color directory", () => {
    expect(Object.keys(en.messages).sort()).toEqual(Object.keys(MESSAGE_DEFINITIONS).sort());
    expect(Object.keys(en.targetLanguageNames)).toHaveLength(156);
    expect(Object.keys(en.namedColorNames)).toHaveLength(10);
  });
  it.each([
    [0, "0 models available."],
    [1, "1 model available."],
    [2, "2 models available."],
    [1000, "1,000 models available."],
  ])("formats %i", (count, text) => {
    expect(createLocalizer("en").format("models.available", { count })).toBe(text);
  });
  it("isolates user and technical text as plain text", () => {
    const l = createLocalizer("en");
    expect(l.format("profile.deleteTitle", { name: "<img onerror=alert(1)>" })).toBe(
      "Delete \u2068<img onerror=alert(1)>\u2069?",
    );
    expect(l.format("endpoint.request", { url: "https://example.invalid/a" })).toContain(
      "\u2066https://example.invalid/a\u2069",
    );
  });
  it.each([-1, 1.5, NaN, Infinity, "1", {}])("rejects damaged count parameters", (count) => {
    expect(createLocalizer("en").format("models.available", { count } as any)).toBe(
      en.messages["feedback.generic"],
    );
  });
  it("retains explicit silence", () => {
    expect(createLocalizer("en").feedback(null)).toBeNull();
  });
});
