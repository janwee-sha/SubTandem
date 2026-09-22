import { encodeWireItems } from "./wire-items.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
  WireTranslationTarget,
} from "./types.js";

const MAX_ITEMS_PER_TRANSLATION_REQUEST = 2;

interface TranslationBatchExecutionOptions {
  maxConcurrentWires?: number;
}

type WireOutcome =
  { status: "fulfilled"; result: TranslationBatchResult } | { status: "rejected"; error: unknown };

export async function runTranslationBatches(
  request: TranslationBatchRequest,
  execute: (jobId: string, items: WireTranslationTarget[]) => Promise<TranslationBatchResult>,
  beforeWire: () => void,
  onProgress?: TranslationProgressHandler,
  options: TranslationBatchExecutionOptions = {},
): Promise<TranslationBatchResult> {
  const wire = encodeWireItems(request.items);
  const combined: TranslationBatchResult = { translations: [] };
  const batches: Array<{ jobId: string; items: WireTranslationTarget[] }> = [];
  for (let offset = 0; offset < wire.items.length; offset += MAX_ITEMS_PER_TRANSLATION_REQUEST) {
    const items = wire.items.slice(offset, offset + MAX_ITEMS_PER_TRANSLATION_REQUEST);
    const part = Math.floor(offset / MAX_ITEMS_PER_TRANSLATION_REQUEST) + 1;
    batches.push({ jobId: `${request.requestId}-part-${part}`, items });
  }
  const configuredConcurrency = options.maxConcurrentWires ?? 1;
  const concurrency = Math.min(
    batches.length,
    Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
      ? configuredConcurrency
      : 1,
  );
  const outcomes: Array<WireOutcome | undefined> = new Array(batches.length);
  let nextBatch = 0;
  let failed = false;
  const run = async (): Promise<void> => {
    while (!failed) {
      const index = nextBatch;
      if (index >= batches.length) return;
      nextBatch += 1;
      const batch = batches[index]!;
      beforeWire();
      try {
        const result = await execute(batch.jobId, batch.items);
        beforeWire();
        outcomes[index] = { status: "fulfilled", result };
        const progress = wire.restore(result);
        if (progress.translations.length > 0) onProgress?.(progress);
      } catch (error) {
        outcomes[index] = { status: "rejected", error };
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  const failure = outcomes.find(
    (outcome): outcome is Extract<WireOutcome, { status: "rejected" }> =>
      outcome?.status === "rejected",
  );
  if (failure) throw failure.error;
  for (const outcome of outcomes) {
    if (outcome?.status !== "fulfilled") continue;
    const parsed = outcome.result;
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
