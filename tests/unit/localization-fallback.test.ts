import { describe, expect, it } from "vitest";
import { createLocalizer, hasIntlCapability, LOCALE_CATALOGS } from "../../src/ui/localization.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import type { LocaleCatalog, MessageParams } from "../../src/shared/localization/types.js";
import en from "../../src/shared/localization/catalogs/en.json";

const generic = en.messages["feedback.generic"];
function brokenCatalog(value: unknown): LocaleCatalog {
  const catalog = structuredClone(LOCALE_CATALOGS.ru);
  (catalog.messages as Record<string, unknown>)["models.available"] = value;
  return catalog;
}

describe("complete production entry fallback", () => {
  it.each([
    undefined,
    "",
    "   ",
    42,
    null,
    [],
    { one: "{count} модель", other: "{count} моделей" },
    { one: "{amount}", few: "{count}", many: "{count}", other: "{count}" },
    { one: "{count}", few: "", many: "{count}", other: "{count}" },
    { one: "{count}", few: "{count}", many: "{count}", other: "<b>{count}</b>" },
  ])("reformats a broken Russian quantity entry with English rules: %j", (value) => {
    const localizer = createLocalizer("ru", { catalogs: { ru: brokenCatalog(value) } });
    expect(localizer.format("models.available", { count: 21 })).toBe("21 models available.");
    expect(localizer.format("models.available", { count: 1000 })).toBe("1,000 models available.");
    expect(localizer.format("sidebar.newProfile")).toBe(
      LOCALE_CATALOGS.ru.messages["sidebar.newProfile"],
    );
  });
  it.each(["does.not.exist", "__proto__", "constructor", "toString"])(
    "returns complete generic English for %s",
    (key) => {
      expect(createLocalizer("he").format(key)).toBe(generic);
    },
  );
  it("never reflects object coercion or invokes accessor parameters", () => {
    let calls = 0;
    const hostile = {
      toString() {
        calls++;
        throw new Error("private-provider-response");
      },
    };
    const getter = Object.defineProperty({}, "name", {
      enumerable: true,
      get() {
        calls++;
        throw new Error("private-key");
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("private-secret");
        },
      },
    );
    for (const params of [
      { name: hostile },
      getter,
      proxy,
      { name: "valid", extra: hostile },
      null,
      [],
    ]) {
      expect(() =>
        createLocalizer("he").format("profile.deleteTitle", params as MessageParams),
      ).not.toThrow();
      expect(createLocalizer("he").format("profile.deleteTitle", params as MessageParams)).toBe(
        generic,
      );
    }
    expect(calls).toBe(0);
  });
  it.each(UI_LOCALES)("uses deterministic complete English when Intl is absent: %s", (locale) => {
    const localizer = createLocalizer(locale, { intl: null });
    expect(localizer.format("models.available", { count: 1 })).toBe("1 model available.");
    expect(localizer.format("models.available", { count: 1000 })).toBe("1000 models available.");
    expect(localizer.format("sidebar.newProfile")).toBe(en.messages["sidebar.newProfile"]);
    expect(localizer.feedback(null)).toBeNull();
  });
  it.each(["PluralRules", "NumberFormat", "Collator"] as const)(
    "detects missing and throwing %s support",
    (capability) => {
      expect(
        hasIntlCapability({ ...Intl, [capability]: undefined } as typeof Intl, "ru", capability),
      ).toBe(false);
      const bad = new Proxy(Intl, {
        get(target, key) {
          if (key === capability) throw new Error("broken-intl");
          return Reflect.get(target, key);
        },
      });
      expect(hasIntlCapability(bad, "ru", capability)).toBe(false);
    },
  );
  it.each(["construct", "format", "select", "categories"])(
    "contains Intl operational failure at %s",
    (failure) => {
      const bad = Object.create(Intl) as typeof Intl;
      const NumberFormat = class extends Intl.NumberFormat {
        constructor(locale?: Intl.LocalesArgument) {
          super(locale);
          if (failure === "construct" && locale === "ru") throw new Error("broken-number");
        }
        get format() {
          if (failure === "format")
            return () => {
              throw new Error("broken-number");
            };
          return super.format;
        }
      };
      const PluralRules = class extends Intl.PluralRules {
        select(value: number) {
          return failure === "select" ? ("impossible" as Intl.LDMLPluralRule) : super.select(value);
        }
        resolvedOptions() {
          const result = super.resolvedOptions();
          if (failure === "categories") result.pluralCategories = undefined as never;
          return result;
        }
      };
      Object.defineProperties(bad, {
        NumberFormat: { value: NumberFormat },
        PluralRules: { value: PluralRules },
      });
      expect(() =>
        createLocalizer("ru", { intl: bad }).format("models.available", { count: 1000 }),
      ).not.toThrow();
      const text = createLocalizer("ru", { intl: bad }).format("models.available", { count: 1000 });
      expect(["1,000 models available.", "1000 models available."]).toContain(text);
      expect(text).not.toMatch(/undefined|\{count\}/);
    },
  );
});

describe("malformed localized text", () => {
  it("falls back for control characters in a complete message", () => {
    const broken = structuredClone(LOCALE_CATALOGS.de);
    (broken.messages as Record<string, unknown>)["sidebar.newProfile"] = "Broken\u0000message";
    expect(createLocalizer("de", { catalogs: { de: broken } }).format("sidebar.newProfile")).toBe(
      en.messages["sidebar.newProfile"],
    );
  });
});
