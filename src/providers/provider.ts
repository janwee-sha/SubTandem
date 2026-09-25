import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "./types.js";

export interface TranslationProvider {
  attempt(
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
    assertAuthorized?: () => void,
  ): Promise<TranslationBatchResult>;
  cancel?(requestId: string): Promise<void> | void;
}

export interface ProviderConnectionTester {
  testConnection(testId: string): Promise<unknown>;
}

export type ConfiguredProvider = TranslationProvider & ProviderConnectionTester;
