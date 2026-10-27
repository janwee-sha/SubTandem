import { describe, expect, it } from "vitest";
import { createOptionDirectory, LOCALE_CATALOGS } from "../../src/ui/localization.js";
import { UI_LOCALES } from "../../src/shared/localization/locales.js";
import { TARGET_LANGUAGES } from "../../src/runtime/domain/target-languages.js";
import baseline from "../fixtures/localization/business-values.json";

function checkOrder(locale: string, options: readonly { id: string; label: string }[]) {
  const collator = new Intl.Collator(locale, {
    usage: "sort",
    sensitivity: "variant",
    numeric: false,
  });
  for (let index = 1; index < options.length; index++) {
    const left = options[index - 1]!,
      right = options[index]!;
    const comparison = collator.compare(left.label, right.label);
    expect(comparison <= 0).toBe(true);
    if (!comparison) expect(left.id < right.id).toBe(true);
  }
}
describe("production named option directory", () => {
  it.each(UI_LOCALES)("localizes and sorts complete targets and colors in %s", (locale) => {
    const projector = createOptionDirectory();
    for (const [kind, items, names] of [
      ["targets", TARGET_LANGUAGES, LOCALE_CATALOGS[locale].targetLanguageNames],
      [
        "colors",
        baseline.namedColors.map(({ id }) => ({
          id,
          requestName: LOCALE_CATALOGS.en.namedColorNames[id]!,
        })),
        LOCALE_CATALOGS[locale].namedColorNames,
      ],
    ] as const) {
      const directory = projector.project(locale, kind, 1, items);
      expect(directory.effectiveLocale).toBe(locale);
      expect(directory.options).toHaveLength(items.length);
      expect(new Set(directory.options.map(({ id }) => id)).size).toBe(items.length);
      for (const option of directory.options) expect(option.displayName).toBe(names[option.id]);
      checkOrder(locale, directory.options);
      const query = directory.options[4]!.displayName.slice(0, 1);
      const filtered = projector.filter(directory, query);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered).toEqual(
        directory.options.filter(({ id }) => filtered.some((option) => option.id === id)),
      );
    }
  });
  it("distinguishes duplicate labels, breaks collation ties by ID, and caches locale plus revision", () => {
    const projector = createOptionDirectory();
    const items = [
      { id: "z", requestName: "same" },
      { id: "a", requestName: "same" },
      { id: "c", requestName: "École" },
      { id: "b", requestName: "école" },
      { id: "d", requestName: "中文" },
      { id: "e", requestName: "model-10" },
      { id: "f", requestName: "model-2" },
    ];
    const first = projector.project("fr", "models", 1, items);
    expect(first.options.find(({ id }) => id === "a")!.label).toBe("same [a]");
    expect(first.options.find(({ id }) => id === "z")!.label).toBe("same [z]");
    checkOrder("fr", first.options);
    expect(
      projector
        .filter(first, "ecole")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["b", "c"]);
    expect(projector.project("fr", "models", 1, items)).toBe(first);
    expect(projector.project("fr", "models", 2, items)).not.toBe(first);
    expect(projector.project("he", "models", 1, items)).not.toBe(first);
    const ties = projector.project("en", "models", 3, [
      { id: "z", requestName: "é" },
      { id: "a", requestName: "e\u0301" },
    ]);
    expect(ties.options.map(({ id }) => id)).toEqual(["a", "z"]);
  });
  it.each([null, "unsupported", "construct", "compare"])(
    "uses a complete English directory for Collator failure %j",
    (fault) => {
      const intl = Object.create(Intl) as typeof Intl;
      if (fault !== null)
        Object.defineProperty(intl, "Collator", {
          value: class extends Intl.Collator {
            constructor(locale?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
              super(locale, options);
              if (fault === "construct") throw new Error("broken");
            }
            static supportedLocalesOf(
              locales: Intl.LocalesArgument,
              options?: Intl.CollatorOptions,
            ) {
              return fault === "unsupported" ? [] : super.supportedLocalesOf(locales, options);
            }
            get compare() {
              return fault === "compare"
                ? () => {
                    throw new Error("broken");
                  }
                : super.compare;
            }
          },
        });
      const directory = createOptionDirectory({ intl: fault === null ? null : intl }).project(
        "he",
        "targets",
        1,
        TARGET_LANGUAGES,
      );
      expect(directory.effectiveLocale).toBe("en");
      for (const option of directory.options)
        expect(option.displayName).toBe(LOCALE_CATALOGS.en.targetLanguageNames[option.id]);
      expect(directory.options).toHaveLength(156);
    },
  );
});
