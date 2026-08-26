import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "./types.js";

export interface TranslationProvider {
  /** Executes exactly one provider attempt. Retry policy belongs to the player session. */
  attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult>;
  cancel?(requestId: string): Promise<void> | void;
}

export interface ProviderConnectionTester {
  testConnection(testId: string): Promise<unknown>;
}

export type ConfiguredProvider = TranslationProvider & ProviderConnectionTester;
