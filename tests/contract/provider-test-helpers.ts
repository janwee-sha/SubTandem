import type { TranslationBatchRequest } from "../../src/providers/types.js";

export function makeProviderRequest(): TranslationBatchRequest {
  return {
    playerId: "player" as TranslationBatchRequest["playerId"],
    requestId: "request" as TranslationBatchRequest["requestId"],
    batchId: "batch" as TranslationBatchRequest["batchId"],
    sessionId: "session" as TranslationBatchRequest["sessionId"],
    sessionEpoch: 1,
    windowEpoch: 1,
    profileId: "profile" as TranslationBatchRequest["profileId"],
    profileRevision: 1,
    endpointFingerprint: "endpoint" as TranslationBatchRequest["endpointFingerprint"],
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
    items: [
      { id: "c1", text: "one", contextNext: "two" },
      { id: "c2", text: "two", contextPrevious: "one" },
    ],
  };
}
