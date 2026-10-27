import { UI_LOCALES } from "../../../src/shared/localization/locales.js";
import { TARGET_LANGUAGES } from "../../../src/runtime/domain/target-languages.js";
import {
  createLocalizer,
  createOptionDirectory,
  hasIntlCapability,
} from "../../../src/ui/localization.js";
const projector = createOptionDirectory();
const results = UI_LOCALES.map((locale) => {
  try {
    const capabilities = Object.fromEntries(
      ["Collator", "PluralRules", "NumberFormat"].map((name) => [
        name,
        hasIntlCapability(Intl, locale, name as "Collator" | "PluralRules" | "NumberFormat"),
      ]),
    );
    const localizer = createLocalizer(locale);
    const directory = projector.project(locale, "targets", 1, TARGET_LANGUAGES);
    const colors = projector.project(
      locale,
      "colors",
      1,
      [
        "transparent",
        "white",
        "red",
        "orange",
        "yellow",
        "green",
        "cyan",
        "blue",
        "purple",
        "black",
      ].map((id) => ({ id, requestName: id })),
    );
    const collator = new Intl.Collator(locale, {
      usage: "sort",
      sensitivity: "variant",
      numeric: false,
    });
    const ordered = directory.options.every(
      (value, index) =>
        index === 0 || collator.compare(directory.options[index - 1]!.label, value.label) <= 0,
    );
    const rules = new Intl.PluralRules(locale, { type: "cardinal" });
    const quantities = [0, 1, 2, 3, 5, 11, 21, 1000, 1000000].map((count) => ({
      count,
      category: rules.select(count),
      number: new Intl.NumberFormat(locale).format(count),
      text: localizer.format("models.available", { count }),
    }));
    return {
      locale,
      capabilities,
      effectiveLocale: directory.effectiveLocale,
      colorsLocale: colors.effectiveLocale,
      categories: rules.resolvedOptions().pluralCategories,
      ordered,
      options: directory.options,
      colors: colors.options,
      quantities,
      plain: localizer.format("sidebar.newProfile"),
      technical: localizer.format("endpoint.request", { url: "https://example.invalid/mixed" }),
      user: localizer.format("profile.deleteTitle", { name: "User Ω <strong>" }),
      status: "ran",
    };
  } catch (error) {
    return {
      locale,
      status: "runtimeFailed",
      error: error instanceof Error ? error.name : "UnknownError",
    };
  }
});
(
  window as unknown as {
    webkit: { messageHandlers: { result: { postMessage(value: unknown): void } } };
  }
).webkit.messageHandlers.result.postMessage(results);
