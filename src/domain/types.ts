export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type PlayerId = Brand<string, "PlayerId">;
export type SessionId = Brand<string, "SessionId">;
export type RequestId = Brand<string, "RequestId">;
export type BatchId = Brand<string, "BatchId">;
export type ProfileId = Brand<string, "ProfileId">;
export type EndpointFingerprint = Brand<string, "EndpointFingerprint">;
export type Sha256Hex = Brand<string, "Sha256Hex">;

export type PersistentProviderKind = "openai" | "claude" | "deepseek" | "ollama";

export interface PersistentProviderProfile {
  profileId: ProfileId;
  revision: number;
  displayName: string;
  kind: PersistentProviderKind;
  endpoint: string;
  endpointFingerprint: EndpointFingerprint;
  proxyMode?: "system" | "direct";
  model?: string;
  capability?: "strict-json-schema" | "json-object" | "prompt-json";
}

export interface ActivationReference {
  profileId: ProfileId;
  profileRevision: number;
  kind: PersistentProviderKind;
  endpointFingerprint: EndpointFingerprint;
  credentialConfigured: boolean;
}

export interface ProfileState {
  profiles: PersistentProviderProfile[];
  activation: ActivationReference | null;
}

export interface StoreCommitReceipt {
  commitId: string;
  operation: "open" | "initialize" | "commit" | "credential-write";
  baseRevision: number;
  requestDigest: string;
}

export interface AuthorityProfile {
  profileId: ProfileId;
  revision: number;
  displayName: string;
  kind: PersistentProviderKind;
  endpoint: string;
  endpointFingerprint: EndpointFingerprint;
  proxyMode: "system" | "direct";
  model?: string;
  credentialConfigured: boolean;
  modelCatalog?: { contextKey: string; models: string[] };
}

export interface AuthoritySnapshot {
  authorityId: string;
  stateVersion: number;
  ready: boolean;
  activationGeneration: number;
  activation: ActivationReference | null;
  profiles: AuthorityProfile[];
}

export type ProfileActivationOutcome = "changed" | "unchanged" | "failed" | "pending";

export interface ProfileActivationResult {
  requestId: string;
  outcome: ProfileActivationOutcome;
  authority: AuthoritySnapshot;
  error?: {
    code: string;
    userAction: string;
  };
}

export interface SessionFingerprint {
  playerId: PlayerId;
  sessionId: SessionId;
  sessionEpoch: number;
  windowEpoch: number;
}

export interface ProviderFingerprint {
  profileId: ProfileId;
  profileRevision: number;
  endpointFingerprint: EndpointFingerprint;
}

export interface SourceSummaryView {
  format: "srt" | "ass";
  cueCount: number;
  warnings: readonly string[];
}

export interface SanitizedConnectionView {
  profileId: ProfileId;
  revision: number;
  displayName: string;
  kind: "openai" | "claude" | "deepseek" | "ollama";
  endpoint: string;
  credentialConfigured: boolean;
}
