import { parseTranslationBatchProgress } from "../../domain/messages.js";
import type { TranslationProvider } from "../../providers/provider.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "../../providers/types.js";

export interface MainGlobalPort {
  onMessage(name: string, callback: (data: unknown) => void): void;
  postMessage(name: string, data: unknown): void;
}

interface PendingAttempt {
  resolve: (result: TranslationBatchResult) => void;
  reject: (error: unknown) => void;
  onProgress?: TranslationProgressHandler;
}

export class GlobalProviderClient implements TranslationProvider {
  private readonly pending = new Map<string, PendingAttempt>();

  constructor(private readonly globalPort: MainGlobalPort) {
    globalPort.onMessage("provider:attempt-progress", (raw: unknown) => {
      const message = raw as { requestId?: unknown; progress?: unknown };
      if (typeof message.requestId !== "string") return;
      const pending = this.pending.get(message.requestId);
      if (!pending?.onProgress) return;
      try {
        pending.onProgress(parseTranslationBatchProgress(message.progress));
      } catch {
        return;
      }
    });
    globalPort.onMessage("provider:attempt-result", (raw: unknown) => {
      const message = raw as { requestId?: unknown; result?: TranslationBatchResult };
      if (typeof message.requestId !== "string" || !message.result) return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      pending.resolve(message.result);
    });
    globalPort.onMessage("provider:attempt-error", (raw: unknown) => {
      const message = raw as { requestId?: unknown; error?: unknown };
      if (typeof message.requestId !== "string") return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      pending.reject(message.error ?? new Error("PROVIDER_ATTEMPT_FAILED"));
    });
  }

  attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    return new Promise((resolve, reject) => {
      if (this.pending.has(request.requestId)) {
        reject(new Error("DUPLICATE_PROVIDER_REQUEST"));
        return;
      }
      this.pending.set(request.requestId, {
        resolve,
        reject,
        ...(onProgress ? { onProgress } : {}),
      });
      this.globalPort.postMessage("provider:attempt", {
        requestId: request.requestId,
        revision: request.profileRevision,
        payload: request,
      });
    });
  }

  cancel(requestId: string): void {
    this.globalPort.postMessage("provider:cancel", {
      requestId,
      revision: 1,
      payload: { requestId },
    });
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.reject({ category: "cancelled", retryable: false });
  }
}
