import { describe, expect, it } from "vitest";
import {
  parseUiLanguageGet,
  parseUiLanguageState,
  parseSidebarStateUpdate,
} from "../../src/runtime/domain/messages.js";
const sample = { hostVersion: "1.5.0", preferredLocalization: "he", failure: null };
const context = {
  authorityId: "authority",
  locale: "he",
  direction: "rtl",
  hostVersion: "1.5.0",
  hostLocalization: "he",
  fallbackReason: null,
};
describe("language message contracts", () => {
  it("accepts exact request and authority response", () => {
    expect(parseUiLanguageGet({ requestId: "request", sample })).toEqual({
      requestId: "request",
      sample,
    });
    expect(parseUiLanguageState({ requestId: "request", context })).toEqual({
      requestId: "request",
      context,
    });
    expect(
      parseSidebarStateUpdate({
        uiLanguage: context,
        profileAuthority: { authorityId: "authority" },
      }).uiLanguage,
    ).toEqual(context);
  });
  it.each(["apiKey", "credentials", "subtitle", "response", "payload"])(
    "rejects extra %s data at each level",
    (field) => {
      expect(() =>
        parseUiLanguageGet({ requestId: "request", sample, [field]: "synthetic" }),
      ).toThrow();
      expect(() =>
        parseUiLanguageGet({ requestId: "request", sample: { ...sample, [field]: "synthetic" } }),
      ).toThrow();
      expect(() =>
        parseUiLanguageState({
          requestId: "request",
          context: { ...context, [field]: "synthetic" },
        }),
      ).toThrow();
    },
  );
  it.each([
    null,
    [],
    "he",
    { ...context, locale: "ar" },
    { ...context, direction: "ltr" },
    { ...context, hostVersion: "future" },
    { ...context, authorityId: 3 },
  ])("rejects invalid contexts", (value) => {
    expect(() => parseUiLanguageState({ requestId: "request", context: value })).toThrow();
  });
  it("rejects missing or conflicting snapshot authority", () => {
    expect(() => parseSidebarStateUpdate({ status: "running" })).toThrow();
    expect(() =>
      parseSidebarStateUpdate({ uiLanguage: context, profileAuthority: { authorityId: "old" } }),
    ).toThrow();
  });
});
