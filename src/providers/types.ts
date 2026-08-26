import type {
  BatchId,
  EndpointFingerprint,
  PlayerId,
  ProfileId,
  RequestId,
  SessionId,
} from "../domain/types.js";

export type ProviderKind = "openai" | "ollama" | "fake";

export type ModelRefreshTrigger =
  | "startup"
  | "open"
  | "endpoint"
  | "profile"
  | "credential"
  | "manual";

export interface ModelDiscoveryContext {
  requestId: string;
  trigger: ModelRefreshTrigger;
  playerId?: PlayerId;
  kind: Exclude<ProviderKind, "fake">;
  endpoint: string;
  endpointFingerprint?: EndpointFingerprint;
  proxyMode: "system" | "direct";
  profileId?: ProfileId;
  profileRevision?: number;
  credentialEpoch: number;
  contextKey: string;
}

export interface ModelCatalog {
  contextKey: string;
  models: string[];
  commitSequence: number;
}

export interface SafeModelDiscoveryError {
  category: ProviderErrorCategory;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  retryAfterMs?: number;
  userAction: string;
}

export type ModelDiscoveryResult =
  | { requestId: string; ok: true; contextKey: string; models: string[] }
  | ({ requestId: string; ok: false; contextKey: string } & SafeModelDiscoveryError);

export interface FrozenTranslationTarget {
  id: string;
  text: string;
  contextPrevious?: string;
  contextNext?: string;
}

export interface WireTranslationTarget {
  id: string;
  text: string;
  context_previous?: string;
  context_next?: string;
}

export interface TranslationBatchRequest {
  playerId: PlayerId;
  requestId: RequestId;
  batchId: BatchId;
  sessionId: SessionId;
  sessionEpoch: number;
  windowEpoch: number;
  profileId: ProfileId;
  profileRevision: number;
  endpointFingerprint: EndpointFingerprint;
  sourceLanguage: string;
  targetLanguage: string;
  items: FrozenTranslationTarget[];
}

export interface TranslationBatchResult {
  translations: Array<{ id: string; text: string }>;
  providerRequestId?: string;
  usage?: { input?: number; output?: number; characters?: number };
}

export interface TranslationBatchProgress {
  translations: Array<{ id: string; text: string }>;
  providerRequestId?: string;
  usage?: { input?: number; output?: number; characters?: number };
}

export type TranslationProgressHandler = (progress: TranslationBatchProgress) => void;

export type ProviderErrorCategory =
  | "network"
  | "timeout"
  | "http"
  | "authentication"
  | "configuration"
  | "model"
  | "quota"
  | "refusal"
  | "protocol"
  | "cancelled";

export interface ProviderAttemptError {
  category: ProviderErrorCategory;
  retryable: boolean;
  statusCode?: number;
  providerCode?: string;
  retryAfterMs?: number;
  providerRequestId?: string;
  userAction: string;
}

export interface ProviderProfileSnapshot {
  profileId: ProfileId;
  revision: number;
  displayName: string;
  kind: Exclude<ProviderKind, "fake">;
  endpoint: string;
  endpointFingerprint: EndpointFingerprint;
  proxyMode?: "system" | "direct";
  model?: string;
  capability?: "strict-json-schema" | "json-object" | "prompt-json";
  credential?: Readonly<Record<string, string>>;
  modelCatalog?: Pick<ModelCatalog, "contextKey" | "models">;
}
