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

function malformedProviderOutput(): never {
  throw new Error("MALFORMED_PROVIDER_OUTPUT");
}

function unwrapClaudeJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return value;
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  if (!match || match[1]!.includes("```")) return malformedProviderOutput();
  return match[1]!;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (/\s/.test(value[index] ?? "")) index += 1;
  return index;
}

function jsonStringEnd(value: string, start: number): number {
  if (value[start] !== '"') return malformedProviderOutput();
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return index + 1;
  }
  return malformedProviderOutput();
}

function topLevelObjectKeys(value: string): string[] {
  let index = skipWhitespace(value, 0);
  if (value[index] !== "{") return malformedProviderOutput();
  index += 1;
  const keys: string[] = [];
  while (index < value.length) {
    index = skipWhitespace(value, index);
    if (value[index] === "}") {
      index = skipWhitespace(value, index + 1);
      if (index !== value.length) return malformedProviderOutput();
      return keys;
    }
    const keyStart = index;
    const keyEnd = jsonStringEnd(value, keyStart);
    const key: unknown = JSON.parse(value.slice(keyStart, keyEnd));
    if (typeof key !== "string") return malformedProviderOutput();
    keys.push(key);
    index = skipWhitespace(value, keyEnd);
    if (value[index] !== ":") return malformedProviderOutput();
    index += 1;
    let objectDepth = 0;
    let arrayDepth = 0;
    let inString = false;
    let escaped = false;
    let foundDelimiter = false;
    for (; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") objectDepth += 1;
      else if (character === "[") arrayDepth += 1;
      else if (character === "}" && objectDepth > 0) objectDepth -= 1;
      else if (character === "]" && arrayDepth > 0) arrayDepth -= 1;
      else if (objectDepth === 0 && arrayDepth === 0 && character === ",") {
        index += 1;
        foundDelimiter = true;
        break;
      } else if (objectDepth === 0 && arrayDepth === 0 && character === "}") {
        index = skipWhitespace(value, index + 1);
        if (index !== value.length) return malformedProviderOutput();
        return keys;
      }
    }
    if (!foundDelimiter) return malformedProviderOutput();
  }
  return malformedProviderOutput();
}

export function normalizeClaudeOutput(requestedIds: readonly string[], value: string): unknown {
  const candidate = unwrapClaudeJsonFence(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return malformedProviderOutput();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return malformedProviderOutput();
  const record = parsed as Record<string, unknown>;
  const serializedKeys = topLevelObjectKeys(candidate);
  if (new Set(serializedKeys).size !== serializedKeys.length) return malformedProviderOutput();
  if (Object.prototype.hasOwnProperty.call(record, "translations")) return record;
  const requested = new Set(requestedIds);
  const keys = Object.keys(record);
  if (
    requestedIds.length === 0 ||
    requested.size !== requestedIds.length ||
    keys.length !== requestedIds.length ||
    keys.some((key) => !requested.has(key))
  )
    return malformedProviderOutput();
  return {
    translations: requestedIds.map((id) => {
      const text = record[id];
      if (typeof text !== "string" || !text.trim()) return malformedProviderOutput();
      return { id, text };
    }),
  };
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
    const text = record.text;
    if (!requested.has(record.id) || counts.get(record.id) !== 1 || !text.trim()) continue;
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
    return { id: record.id, text: record.text };
  });
  if (seen.size !== requested.size) throw new Error("MALFORMED_PROVIDER_OUTPUT");
  return { translations };
}
