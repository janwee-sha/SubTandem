import type {
  FrozenTranslationTarget,
  TranslationBatchResult,
  WireTranslationTarget,
} from "./types.js";

export interface WireItems {
  items: WireTranslationTarget[];
  restore(result: TranslationBatchResult): TranslationBatchResult;
}

export function encodeWireItems(items: readonly FrozenTranslationTarget[]): WireItems {
  const originalIds = new Map<string, string>();
  const wireItems = items.map((item, index) => {
    const wireId = `c${index + 1}`;
    originalIds.set(wireId, item.id);
    return {
      id: wireId,
      text: item.text,
      ...(item.contextPrevious ? { context_previous: item.contextPrevious } : {}),
      ...(item.contextNext ? { context_next: item.contextNext } : {}),
    };
  });
  return {
    items: wireItems,
    restore(result) {
      return {
        ...result,
        translations: result.translations.flatMap((translation) => {
          const originalId = originalIds.get(translation.id);
          return originalId ? [{ id: originalId, text: translation.text }] : [];
        }),
      };
    },
  };
}

export function providerOutputSchema(ids: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["translations"],
    properties: {
      translations: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text"],
          properties: {
            id: { type: "string", enum: [...ids] },
            text: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}
