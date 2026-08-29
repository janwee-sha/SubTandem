import type { TranslationBatchResult } from "./types.js";

function parsedObject(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("MALFORMED_PROVIDER_OUTPUT");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("MALFORMED_PROVIDER_OUTPUT");
  return parsed as Record<string, unknown>;
}

export function validateIdOutput(
  requestedIds: readonly string[],
  value: unknown,
): TranslationBatchResult & { missingIds: string[] } {
  const parsed = parsedObject(value);
  if (typeof parsed.refusal === "string" && parsed.refusal) throw new Error("PROVIDER_REFUSAL");
  if (!Array.isArray(parsed.translations)) throw new Error("MALFORMED_PROVIDER_OUTPUT");
  const counts = new Map<string, number>();
  for (const item of parsed.translations) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).id === "string"
    ) {
      const id = (item as Record<string, unknown>).id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const requested = new Set(requestedIds);
  const translations: Array<{ id: string; text: string }> = [];
  for (const item of parsed.translations) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.text !== "string") continue;
    const text = record.text.trim();
    if (!requested.has(record.id) || counts.get(record.id) !== 1 || !text) continue;
    translations.push({ id: record.id, text });
  }
  const accepted = new Set(translations.map((item) => item.id));
  const missingIds = requestedIds.filter((id) => !accepted.has(id));
  const usageRecord =
    parsed.usage && typeof parsed.usage === "object" && !Array.isArray(parsed.usage)
      ? (parsed.usage as Record<string, unknown>)
      : null;
  const usage = usageRecord
    ? {
        ...(typeof usageRecord.input === "number" ? { input: usageRecord.input } : {}),
        ...(typeof usageRecord.output === "number" ? { output: usageRecord.output } : {}),
        ...(typeof usageRecord.characters === "number"
          ? { characters: usageRecord.characters }
          : {}),
      }
    : undefined;
  return { translations, missingIds, ...(usage && Object.keys(usage).length ? { usage } : {}) };
}

export function validateStrictIdOutput(
  requestedIds: readonly string[],
  value: unknown,
): TranslationBatchResult {
  const parsed = parsedObject(value);
  if (Object.keys(parsed).join(",") !== "translations" || !Array.isArray(parsed.translations))
    throw new Error("MALFORMED_PROVIDER_OUTPUT");
  if (
    requestedIds.length === 0 ||
    new Set(requestedIds).size !== requestedIds.length ||
    parsed.translations.length !== requestedIds.length
  )
    throw new Error("MALFORMED_PROVIDER_OUTPUT");
  const requested = new Set(requestedIds);
  const seen = new Set<string>();
  const translations = parsed.translations.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("MALFORMED_PROVIDER_OUTPUT");
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "id,text" ||
      typeof record.id !== "string" ||
      !requested.has(record.id) ||
      seen.has(record.id) ||
      typeof record.text !== "string" ||
      !record.text.trim()
    )
      throw new Error("MALFORMED_PROVIDER_OUTPUT");
    seen.add(record.id);
    return { id: record.id, text: record.text.trim() };
  });
  if (seen.size !== requested.size) throw new Error("MALFORMED_PROVIDER_OUTPUT");
  return { translations };
}
