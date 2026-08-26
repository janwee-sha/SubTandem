export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type PlayerId = Brand<string, "PlayerId">;
export type SessionId = Brand<string, "SessionId">;
export type RequestId = Brand<string, "RequestId">;
export type BatchId = Brand<string, "BatchId">;
export type ProfileId = Brand<string, "ProfileId">;
export type EndpointFingerprint = Brand<string, "EndpointFingerprint">;
export type Sha256Hex = Brand<string, "Sha256Hex">;

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
  language: string | null;
  warnings: readonly string[];
}

export interface SanitizedConnectionView {
  profileId: ProfileId;
  revision: number;
  displayName: string;
  kind: "openai" | "ollama";
  endpoint: string;
  credentialConfigured: boolean;
}
