import type { TranslationProvider } from "../../src/providers/provider.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "../../src/providers/types.js";

export class RecordingProvider implements TranslationProvider {
  readonly requests: TranslationBatchRequest[] = [];
  private readonly responders: Array<
    (
      request: TranslationBatchRequest,
      onProgress?: TranslationProgressHandler,
    ) => Promise<TranslationBatchResult>
  > = [];

  enqueue(
    responder: (
      request: TranslationBatchRequest,
      onProgress?: TranslationProgressHandler,
    ) => Promise<TranslationBatchResult>,
  ): void {
    this.responders.push(responder);
  }

  async attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    this.requests.push(structuredClone(request));
    const responder = this.responders.shift();
    if (responder) return responder(request, onProgress);
    const result = {
      translations: request.items.map((item) => ({
        id: item.id,
        text: `translated:${item.text}`,
      })),
    };
    onProgress?.(result);
    return result;
  }
}
