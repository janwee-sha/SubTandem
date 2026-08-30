import { encodeWireItems } from "./wire-items.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";

const MAX_ITEMS_PER_TRANSLATION_REQUEST = 2;

export async function runTranslationBatches(
  request: TranslationBatchRequest,
  execute: (jobId: string, items: WireTranslationTarget[]) => Promise<TranslationBatchResult>,
  beforeWire: () => void,
  onProgress?: TranslationProgressHandler,
): Promise<TranslationBatchResult> {
  const wire = encodeWireItems(request.items);
  const combined: TranslationBatchResult = { translations: [] };
  for (let offset = 0; offset < wire.items.length; offset += MAX_ITEMS_PER_TRANSLATION_REQUEST) {
    beforeWire();
    const items = wire.items.slice(offset, offset + MAX_ITEMS_PER_TRANSLATION_REQUEST);
    const part = Math.floor(offset / MAX_ITEMS_PER_TRANSLATION_REQUEST) + 1;
    const parsed = await execute(`${request.requestId}-part-${part}`, items);
    beforeWire();
    const progress = wire.restore(parsed);
    if (progress.translations.length > 0) onProgress?.(progress);
    combined.translations.push(...parsed.translations);
    if (parsed.providerRequestId && !combined.providerRequestId)
      combined.providerRequestId = parsed.providerRequestId;
    for (const key of ["input", "output", "characters"] as const) {
      const value = parsed.usage?.[key];
      if (value === undefined) continue;
      combined.usage ??= {};
      combined.usage[key] = (combined.usage[key] ?? 0) + value;
    }
  }
  beforeWire();
  return wire.restore(combined);
}
