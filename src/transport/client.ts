import { SubTandemError } from "../domain/errors.js";
import type {
  ActivationReference,
  PersistentProviderProfile,
  ProfileState,
  StoreCommitReceipt,
} from "../domain/types.js";

export interface LocalRpcBridge {
  post<T>(
    port: number,
    bearerToken: string,
    path: string,
    body: unknown,
    options?: { timeoutMs?: number; assertActive?: () => void },
  ): Promise<T>;
  close?(error?: unknown): void;
}

export class LocalRpcResponseError extends Error {
  constructor(readonly code: string) {
    super("HELPER_RPC_FAILED");
    this.name = "LocalRpcResponseError";
  }
}

export const TRANSPORT_RPC_ERROR_CODES = [
  "upstream-timeout",
  "upstream-network",
  "forbidden-destination",
  "duplicate-job",
  "invalid-request",
  "response-too-large",
  "request-cancelled",
  "request-failed",
  "unauthorized",
  "request-too-large",
  "not-found",
  "invalid-credential-request",
  "credential-store-unavailable",
  "profile-state-conflict",
  "invalid-profile-state",
  "invalid-cancel-request",
  "helper-rpc-failed",
] as const;

export type TransportRpcErrorCode = (typeof TRANSPORT_RPC_ERROR_CODES)[number];

export function isTransportRpcErrorCode(value: unknown): value is TransportRpcErrorCode {
  return (
    typeof value === "string" && TRANSPORT_RPC_ERROR_CODES.includes(value as TransportRpcErrorCode)
  );
}

export class TransportRpcError extends Error {
  constructor(readonly code: TransportRpcErrorCode) {
    super(code);
    this.name = "TransportRpcError";
  }
}

function rpcError(error: TransportRpcError): SubTandemError {
  switch (error.code) {
    case "upstream-timeout":
      return new SubTandemError("PROVIDER_TIMEOUT", "timeout", "CHECK_NETWORK", true, 504);
    case "upstream-network":
      return new SubTandemError("PROVIDER_NETWORK", "network", "CHECK_NETWORK", true, 502);
    case "forbidden-destination":
      return new SubTandemError("FORBIDDEN_DESTINATION", "configuration", "CHECK_ENDPOINT");
    case "request-cancelled":
      return new SubTandemError("REQUEST_CANCELLED", "cancelled", "NONE");
    case "response-too-large":
      return new SubTandemError("HELPER_RESPONSE_TOO_LARGE", "protocol", "CHECK_ENDPOINT");
    case "credential-store-unavailable":
      return new SubTandemError("CREDENTIAL_STORE_UNAVAILABLE", "configuration", "RESTART_IINA");
    case "profile-state-conflict":
      return new SubTandemError("PROFILE_STATE_CONFLICT", "configuration", "NONE", true, 409);
    case "invalid-profile-state":
      return new SubTandemError("INVALID_PROFILE_STATE", "protocol", "RESTART_IINA");
    case "helper-rpc-failed":
      return new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    case "unauthorized":
      return new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    default:
      return new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }
}

export interface TransportRequest {
  jobId: string;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  proxyMode?: "system" | "direct";
  body?: unknown;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface TransportResponse {
  jobId: string;
  transportState: "completed" | "cancelled" | "timedOut";
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface TransportSession {
  port: number;
  token: string;
}

export interface ProfileStateStoreSnapshot {
  initialized: boolean;
  storeRevision: number;
  lastCommit: StoreCommitReceipt | null;
  profileState: ProfileState | null;
  credentialConfigured: Record<string, boolean>;
  invalidActivation?: true;
}

export type ProfileStateCommitResult =
  | ({ state: "committed" } & ProfileStateStoreSnapshot)
  | ({ state: "reconciling" } & ProfileStateStoreSnapshot);

export interface TransportRpcClient {
  health(): Promise<void>;
  credentialRead(profileId: string): Promise<Record<string, string> | null>;
  credentialWrite(
    profileId: string,
    fields: Record<string, string>,
    commitId: string,
    expectedStoreRevision: number,
    expectedProfileRevision: number,
  ): Promise<ProfileStateCommitResult>;
  profileStateRead(): Promise<ProfileStateStoreSnapshot>;
  profileStateOpen(commitId: string): Promise<ProfileStateCommitResult>;
  profileStateInitialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult>;
  profileStateCommit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult>;
  request(request: TransportRequest, assertActive?: () => void): Promise<TransportResponse>;
  cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown">;
  shutdown(): Promise<void>;
  dispose?(): void;
}

const controlRpcTimeoutMs = 1_000;
const providerRpcTimeoutMs = 130_000;

export class TransportClient implements TransportRpcClient {
  constructor(
    private readonly session: TransportSession,
    private readonly bridge: LocalRpcBridge,
  ) {
    if (!Number.isInteger(session.port) || session.port < 1024 || session.port > 65535) {
      throw new Error("Invalid helper port");
    }
    if (!/^[A-Za-z0-9_-]{8,512}$/.test(session.token)) throw new Error("Invalid helper token");
  }

  private async post<T>(
    path: string,
    body: unknown,
    timeoutMs = controlRpcTimeoutMs,
    assertActive?: () => void,
  ): Promise<T> {
    try {
      return await this.bridge.post<T>(this.session.port, this.session.token, path, body, {
        timeoutMs,
        ...(assertActive ? { assertActive } : {}),
      });
    } catch (error) {
      assertActive?.();
      if (error instanceof SubTandemError) throw error;
      if (error instanceof TransportRpcError) throw rpcError(error);
      if (error instanceof LocalRpcResponseError) {
        const code = isTransportRpcErrorCode(error.code) ? error.code : "helper-rpc-failed";
        throw rpcError(new TransportRpcError(code));
      }
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    }
  }

  async health(): Promise<void> {
    const response = await this.post<{ state: "ok" }>("/v1/health", {});
    if (response.state !== "ok")
      throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
  }

  async credentialRead(profileId: string): Promise<Record<string, string> | null> {
    const response = await this.post<{ fields: Record<string, string> | null }>("/v1/credentials", {
      action: "read",
      profileId,
    });
    return response.fields ? { ...response.fields } : null;
  }

  async credentialWrite(
    profileId: string,
    fields: Record<string, string>,
    commitId: string,
    expectedStoreRevision: number,
    expectedProfileRevision: number,
  ): Promise<ProfileStateCommitResult> {
    const response = await this.post<unknown>("/v1/credentials", {
      action: "write",
      profileId,
      fields,
      commitId,
      expectedStoreRevision,
      expectedProfileRevision,
    });
    return parseProfileStateCommitResult(response);
  }

  async profileStateRead(): Promise<ProfileStateStoreSnapshot> {
    return parseProfileStateStoreSnapshot(
      await this.post<unknown>("/v1/profile-state", { action: "read" }),
    );
  }

  async profileStateOpen(commitId: string): Promise<ProfileStateCommitResult> {
    return parseProfileStateCommitResult(
      await this.post<unknown>("/v1/profile-state", { action: "open", commitId }),
    );
  }

  async profileStateInitialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: PersistentProviderProfile[],
  ): Promise<ProfileStateCommitResult> {
    return parseProfileStateCommitResult(
      await this.post<unknown>("/v1/profile-state", {
        action: "initialize",
        commitId,
        expectedStoreRevision,
        profiles,
      }),
    );
  }

  async profileStateCommit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult> {
    return parseProfileStateCommitResult(
      await this.post<unknown>("/v1/profile-state", {
        action: "commit",
        commitId,
        expectedStoreRevision,
        profileState,
      }),
    );
  }

  request(request: TransportRequest, assertActive?: () => void): Promise<TransportResponse> {
    assertActive?.();
    return this.post("/v1/request", request, providerRpcTimeoutMs, assertActive);
  }

  async cancel(jobId: string): Promise<"cancelled" | "already-completed" | "unknown"> {
    const response = await this.post<{ state: "cancelled" | "already-completed" | "unknown" }>(
      "/v1/cancel",
      { jobId },
    );
    return response.state;
  }

  async shutdown(): Promise<void> {
    try {
      await this.post("/v1/shutdown", {});
    } finally {
      this.dispose();
    }
  }

  dispose(): void {
    this.bridge.close?.();
  }
}

function protocolFailure(): never {
  throw new SubTandemError("HELPER_PROTOCOL", "protocol", "RESTART_IINA");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[]): boolean {
  return Object.keys(record).sort().join(",") === [...required].sort().join(",");
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
}

function parseStoredProfile(value: unknown): PersistentProviderProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  const optional = [
    ...(record.capability === undefined ? [] : ["capability"]),
    ...(record.model === undefined ? [] : ["model"]),
  ];
  if (
    !exactKeys(record, [
      "profileId",
      "revision",
      "displayName",
      "kind",
      "endpoint",
      "endpointFingerprint",
      "proxyMode",
      ...optional,
    ]) ||
    !opaque(record.profileId) ||
    !safeInteger(record.revision, 1) ||
    typeof record.displayName !== "string" ||
    !record.displayName.trim() ||
    !["openai", "claude", "deepseek", "ollama"].includes(String(record.kind)) ||
    typeof record.endpoint !== "string" ||
    !record.endpoint ||
    !opaque(record.endpointFingerprint) ||
    (record.proxyMode !== "system" && record.proxyMode !== "direct") ||
    (record.model !== undefined && (typeof record.model !== "string" || !record.model.trim())) ||
    (record.capability !== undefined &&
      !["strict-json-schema", "json-object", "prompt-json"].includes(String(record.capability)))
  )
    protocolFailure();
  return cloneJson(record) as unknown as PersistentProviderProfile;
}

function parseActivation(value: unknown): ActivationReference | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, [
      "profileId",
      "profileRevision",
      "kind",
      "endpointFingerprint",
      "credentialConfigured",
    ]) ||
    !opaque(record.profileId) ||
    !safeInteger(record.profileRevision, 1) ||
    !["openai", "claude", "deepseek", "ollama"].includes(String(record.kind)) ||
    !opaque(record.endpointFingerprint) ||
    typeof record.credentialConfigured !== "boolean"
  )
    protocolFailure();
  return cloneJson(record) as unknown as ActivationReference;
}

function parseProfileState(value: unknown): ProfileState | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["profiles", "activation"]) || !Array.isArray(record.profiles))
    protocolFailure();
  const profiles = record.profiles.map(parseStoredProfile);
  if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length)
    protocolFailure();
  return { profiles, activation: parseActivation(record.activation) };
}

function parseCommitReceipt(value: unknown): StoreCommitReceipt | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["commitId", "operation", "baseRevision", "requestDigest"]) ||
    !opaque(record.commitId) ||
    !["open", "initialize", "commit", "credential-write"].includes(String(record.operation)) ||
    !safeInteger(record.baseRevision) ||
    !opaque(record.requestDigest)
  )
    protocolFailure();
  return cloneJson(record) as unknown as StoreCommitReceipt;
}

export function parseProfileStateStoreSnapshot(value: unknown): ProfileStateStoreSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  const optional = record.invalidActivation === undefined ? [] : ["invalidActivation"];
  if (
    !exactKeys(record, [
      "initialized",
      "storeRevision",
      "lastCommit",
      "profileState",
      "credentialConfigured",
      ...optional,
    ]) ||
    typeof record.initialized !== "boolean" ||
    !safeInteger(record.storeRevision) ||
    (record.invalidActivation !== undefined && record.invalidActivation !== true) ||
    !record.credentialConfigured ||
    typeof record.credentialConfigured !== "object" ||
    Array.isArray(record.credentialConfigured)
  )
    protocolFailure();
  const profileState = parseProfileState(record.profileState);
  if (record.initialized !== Boolean(profileState)) protocolFailure();
  const configured = record.credentialConfigured as Record<string, unknown>;
  if (
    Object.values(configured).some((entry) => typeof entry !== "boolean") ||
    (profileState &&
      !exactKeys(
        configured,
        profileState.profiles.map((profile) => profile.profileId),
      )) ||
    (!profileState && Object.keys(configured).length > 0)
  )
    protocolFailure();
  return {
    initialized: record.initialized,
    storeRevision: record.storeRevision,
    lastCommit: parseCommitReceipt(record.lastCommit),
    profileState,
    credentialConfigured: cloneJson(configured) as Record<string, boolean>,
    ...(record.invalidActivation === true ? { invalidActivation: true as const } : {}),
  };
}

export function parseProfileStateCommitResult(value: unknown): ProfileStateCommitResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolFailure();
  const record = value as Record<string, unknown>;
  if (record.state !== "committed") protocolFailure();
  const snapshot = { ...record };
  delete snapshot.state;
  return { state: "committed", ...parseProfileStateStoreSnapshot(snapshot) };
}
