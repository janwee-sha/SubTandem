import type { UiLocale } from "./localization/locales.js";

const supportPageFiles: Partial<Record<UiLocale, string>> = {
  "zh-Hans": "README.zh-Hans.md",
  "zh-Hant": "README.zh-Hant.md",
  fr: "README.fr.md",
  ja: "README.ja.md",
  ko: "README.ko.md",
  ru: "README.ru.md",
};

export function supportPageUrl(locale: UiLocale): string {
  const file = supportPageFiles[locale] ?? "README.md";
  return `https://github.com/janwee-sha/SubTandem/blob/main/docs/support/${file}`;
}
