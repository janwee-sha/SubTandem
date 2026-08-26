export function normalizeLanguageTag(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().replace(/_/g, "-").split("-");
  if (!parts[0] || !/^[A-Za-z]{2,3}$/.test(parts[0]) || parts[0].toLowerCase() === "und")
    return null;
  const aliases: Record<string, string> = { iw: "he", in: "id", ji: "yi" };
  const base = parts[0].toLowerCase();
  const normalized = [aliases[base] ?? base];
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{4}$/.test(part))
      normalized.push(part[0]!.toUpperCase() + part.slice(1).toLowerCase());
    else if (/^[A-Za-z]{2}$/.test(part)) normalized.push(part.toUpperCase());
    else if (/^\d{3}$/.test(part)) normalized.push(part);
    else if (/^[A-Za-z0-9]{5,8}$/.test(part)) normalized.push(part.toLowerCase());
    else return null;
  }
  const result = normalized.join("-");
  if (/^zh-(CN|SG)$/i.test(result)) return "zh-Hans";
  if (/^zh-(TW|HK|MO)$/i.test(result)) return "zh-Hant";
  return result;
}

export function baseLanguage(value: string): string | null {
  return normalizeLanguageTag(value)?.split("-")[0] ?? null;
}

export function shouldTranslate(source: string, target: string): boolean {
  const normalizedSource = normalizeLanguageTag(source);
  const normalizedTarget = normalizeLanguageTag(target);
  if (!normalizedSource || !normalizedTarget) return false;
  if (baseLanguage(normalizedSource) !== baseLanguage(normalizedTarget)) return true;
  if (normalizedTarget === "zh-Hans" || normalizedTarget === "zh-Hant")
    return normalizedSource !== normalizedTarget;
  if (normalizedTarget === "pt-PT") return normalizedSource !== normalizedTarget;
  return false;
}
