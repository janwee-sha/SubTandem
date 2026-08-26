import type { TranslationProvider } from "./provider.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "./types.js";

export class DeterministicFakeProvider implements TranslationProvider {
  constructor(private readonly prefix = "translated:") {}

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    const result = {
      translations: request.items.map((item) => ({
        id: item.id,
        text: `${this.prefix}${item.text}`,
      })),
    };
    onProgress?.(result);
    return result;
  }
}
