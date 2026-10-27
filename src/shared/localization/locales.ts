export const UI_LOCALES = [
  "af",
  "ca",
  "cs",
  "da",
  "de",
  "en",
  "en-GB",
  "es",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sr-Latn",
  "sv",
  "tr",
  "uk",
  "zh-Hans",
  "zh-Hant",
] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function canonicalUiLocale(value: unknown): UiLocale | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/_/g, "-").toLowerCase();
  return UI_LOCALES.find((locale) => locale.toLowerCase() === normalized) ?? null;
}
