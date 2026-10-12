import { describe, expect, it } from "vitest";
import { UiLanguageAuthority } from "../../src/app/ui-language-authority.js";
import { UI_LOCALES } from "../../shared/localization/locales.js";
const sample = (locale: string) => ({
  hostVersion: "1.5.0",
  preferredLocalization: locale,
  failure: null,
});
describe("UI language authority", () => {
  it.each(UI_LOCALES)("freezes equivalent %s labels synchronously", (locale) => {
    const authority = new UiLanguageAuthority("authority-1");
    const context = authority.resolve(sample(locale.toUpperCase().replace(/-/g, "_")));
    expect(context).toMatchObject({
      authorityId: "authority-1",
      locale,
      direction: locale === "he" ? "rtl" : "ltr",
      fallbackReason: null,
    });
    expect(authority.resolve(sample("en"))).toBe(context);
    expect(new UiLanguageAuthority("authority-2").resolve(sample("en")).locale).toBe("en");
  });
  it.each(["zh", "sr", "sr-Cyrl", "ar", "pt-AO", "en-US", "de-DE"])(
    "does not guess %s",
    (locale) => {
      expect(new UiLanguageAuthority("authority").resolve(sample(locale))).toMatchObject({
        locale: "en",
        direction: "ltr",
        fallbackReason: "unsupportedLocale",
      });
    },
  );
  it("freezes a failure and never adopts a later success", () => {
    const a = new UiLanguageAuthority("authority");
    const first = a.resolve({
      hostVersion: null,
      preferredLocalization: null,
      failure: "unknownVersion",
    });
    expect(a.resolve(sample("he"))).toBe(first);
  });
  it("does not freeze malformed samples", () => {
    const a = new UiLanguageAuthority("authority");
    expect(() => a.resolve({ ...sample("de"), apiKey: "synthetic" })).toThrow();
    expect(a.context).toBeNull();
    expect(a.resolve(sample("he")).locale).toBe("he");
  });
});

import { globalProviderHarness } from "../helpers/global-provider-harness.js";

it("freezes the production Global context before Profile restoration and ignores unregistered input", async () => {
  const h = await globalProviderHarness([], true);
  h.unregisterPlayer("unregistered");
  h.sendRaw("ui-language:get", { requestId: "ignored", sample: sample("he") }, "unregistered");
  h.sendRaw(
    "ui-language:get",
    { requestId: "malformed", sample: { ...sample("he"), subtitle: "synthetic" } },
    "window-1",
  );
  expect(h.replies).toHaveLength(0);
  h.sendRaw("ui-language:get", { requestId: "first", sample: sample("de") }, "window-1");
  expect(h.replies.at(-1)).toMatchObject({
    sender: "window-1",
    name: "ui-language:state",
    data: { requestId: "first", context: { locale: "de" } },
  });
  const authorityId = h.replies.at(-1)!.data.context.authorityId;
  h.sendRaw("ui-language:get", { requestId: "second", sample: sample("he") }, "window-2");
  expect(h.replies.at(-1)!.data.context).toMatchObject({ locale: "de", authorityId });
  h.ready.releaseNext(undefined);
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(h.authority.snapshot.authorityId).toBe(authorityId);
});
