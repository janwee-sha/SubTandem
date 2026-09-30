export const CREDENTIAL_PROTOCOL_VERSION = 2 as const;
export const CREDENTIAL_LIMITS = Object.freeze({
  keyBytes: 8192,
  sealedBytes: 32768,
  documentBytes: 1048576,
  mailboxBytes: 2097152,
  requestBytes: 2097152,
  responseBytes: 4194304,
  idleMs: 300000,
  messages: 4096,
  receiveWindow: 128,
});

export const CREDENTIAL_ERRORS = [
  "invalid-credential-message",
  "credential-channel-unavailable",
  "credential-channel-expired",
  "credential-authentication-failed",
  "credential-replay",
  "credential-owner-mismatch",
  "credential-hardware-unavailable",
  "credential-unavailable",
  "credential-reflection",
  "credential-too-large",
  "credential-protocol-mismatch",
] as const;
export type CredentialErrorCode = (typeof CREDENTIAL_ERRORS)[number];
export type CredentialPurpose = "read-edit" | "save-profile" | "draft-test" | "draft-models";
export type CredentialDirection = "sidebar-to-helper" | "helper-to-sidebar";
export type CredentialProviderKind = "openai" | "claude" | "deepseek" | "ollama";

export interface CredentialSourceProfile {
  profileId: string;
  profileRevision: number;
  endpointFingerprint: string;
}
export interface CredentialOwner {
  sidebarInstanceId: string;
  senderId: string;
  drawerId: string;
}
export interface CredentialChannelOpen {
  protocolVersion: 2;
  sidebarInstanceId: string;
  drawerId: string;
  sourceProfile: CredentialSourceProfile | null;
  clientPublicKey: string;
}
export interface CredentialChannelOffer extends CredentialChannelOpen, CredentialOwner {
  helperSessionId: string;
  channelId: string;
  helperPublicKey: string;
  salt: string;
}
export interface CredentialHandshake {
  protocolVersion: 2;
  channelId: string;
  helperSessionId: string;
  sequence: 0;
  sealedPayload: string;
}
export interface CredentialOperationContext {
  requestId: string;
  draftRevision: number;
  keyEditEpoch: number;
  submitEpoch: number;
  purpose: CredentialPurpose;
  sourceProfile: CredentialSourceProfile | null;
  kind: CredentialProviderKind;
  endpointFingerprint: string;
  snapshotDigest: string;
  expiresAtMs: number;
}
export interface CredentialEnvelope {
  protocolVersion: 2;
  channelId: string;
  helperSessionId: string;
  sequence: number;
  context: CredentialOperationContext;
  snapshotBytes: string;
  sealedPayload: string;
}
export interface CredentialSnapshotProfile {
  profileId: string;
  revision: number;
  displayName: string;
  kind: CredentialProviderKind;
  endpoint: string;
  endpointFingerprint: string;
  proxyMode: "system" | "direct";
  model?: string;
  capability?: "strict-json-schema" | "json-object" | "prompt-json";
}
export interface CredentialSnapshotState {
  profiles: CredentialSnapshotProfile[];
  activation:
    | (CredentialSourceProfile & { kind: CredentialProviderKind; credentialConfigured: boolean })
    | null;
}
export interface CredentialOperationSnapshot {
  kind: CredentialProviderKind;
  endpoint: string;
  model: string | null;
  proxyMode: "system" | "direct";
  purpose: CredentialPurpose;
  sourceProfile: CredentialSourceProfile | null;
  save: {
    commitId: string;
    expectedStoreRevision: number;
    expectedProfileRevision: number | null;
    profileState: CredentialSnapshotState;
  } | null;
}
export interface SavedCredentialReference extends CredentialSourceProfile {
  source: "saved";
  kind: CredentialProviderKind;
}
export interface DraftOperationReference {
  source: "draft";
  operationId: string;
  channelId: string;
  requestId: string;
  owner: CredentialOwner;
  purpose: "draft-test" | "draft-models";
  snapshotDigest: string;
  deadlineMs: number;
}
export type CredentialReference =
  SavedCredentialReference | DraftOperationReference | { source: "none" };

export function parseDraftOperationReference(value: unknown): DraftOperationReference {
  const r = credentialRecord(value, ["source", "operationId", "channelId", "requestId", "owner", "purpose", "snapshotDigest", "deadlineMs"]);
  const owner = credentialRecord(r.owner, ["senderId", "sidebarInstanceId", "drawerId"]);
  credentialAssert(r.source === "draft" && credentialIdentity(r.operationId) && credentialIdentity(r.channelId) && credentialIdentity(r.requestId) && Object.values(owner).every(credentialIdentity) && ["draft-test", "draft-models"].includes(String(r.purpose)) && typeof r.snapshotDigest === "string" && /^[a-f0-9]{64}$/.test(r.snapshotDigest) && credentialInteger(r.deadlineMs, 1));
  return JSON.parse(JSON.stringify(r)) as DraftOperationReference;
}

export class CredentialProtocolError extends Error {
  constructor(readonly code: CredentialErrorCode = "invalid-credential-message") {
    super(code);
    this.name = "CredentialProtocolError";
  }
}
export function credentialAssert(
  condition: unknown,
  code?: CredentialErrorCode,
): asserts condition {
  if (!condition) throw new CredentialProtocolError(code);
}
export function credentialRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  credentialAssert(value !== null && typeof value === "object" && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  credentialAssert(
    required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
      Object.keys(record).every((key) => required.includes(key) || optional.includes(key)),
  );
  return record;
}
export function credentialInteger(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
export function credentialIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}
export function credentialUtf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%") {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
}
export function credentialText(value: Uint8Array): string {
  try {
    return decodeURIComponent(
      Array.from(value, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
    );
  } catch {
    throw new CredentialProtocolError();
  }
}
export function credentialArray(value: unknown[]): Uint8Array {
  return credentialUtf8(JSON.stringify(value));
}
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function credentialBase64(value: Uint8Array): string {
  let result = "";
  for (let i = 0; i < value.length; i += 3) {
    const n = (value[i]! << 16) | ((value[i + 1] ?? 0) << 8) | (value[i + 2] ?? 0);
    result +=
      BASE64[(n >>> 18) & 63]! +
      BASE64[(n >>> 12) & 63]! +
      (i + 1 < value.length ? BASE64[(n >>> 6) & 63]! : "=") +
      (i + 2 < value.length ? BASE64[n & 63]! : "=");
  }
  return result;
}
export function credentialDecode(
  value: unknown,
  maxBytes: number,
  exactBytes?: number,
): Uint8Array {
  credentialAssert(
    typeof value === "string" &&
      value.length <= Math.ceil(maxBytes / 3) * 4 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
  );
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 4) {
    const n =
      (BASE64.indexOf(value[i]!) << 18) |
      (BASE64.indexOf(value[i + 1]!) << 12) |
      (Math.max(0, BASE64.indexOf(value[i + 2]!)) << 6) |
      Math.max(0, BASE64.indexOf(value[i + 3]!));
    bytes.push((n >>> 16) & 255);
    if (value[i + 2] !== "=") bytes.push((n >>> 8) & 255);
    if (value[i + 3] !== "=") bytes.push(n & 255);
  }
  const decoded = Uint8Array.from(bytes);
  credentialAssert(
    decoded.length <= maxBytes &&
      (exactBytes === undefined || decoded.length === exactBytes) &&
      credentialBase64(decoded) === value,
  );
  return decoded;
}
export function parseCredentialSource(value: unknown): CredentialSourceProfile | null {
  if (value === null) return null;
  const r = credentialRecord(value, ["profileId", "profileRevision", "endpointFingerprint"]);
  credentialAssert(
    credentialIdentity(r.profileId) &&
      credentialInteger(r.profileRevision, 1) &&
      credentialIdentity(r.endpointFingerprint),
  );
  return r as unknown as CredentialSourceProfile;
}
export function parseCredentialOpen(value: unknown): CredentialChannelOpen {
  const r = credentialRecord(value, [
    "protocolVersion",
    "sidebarInstanceId",
    "drawerId",
    "sourceProfile",
    "clientPublicKey",
  ]);
  credentialAssert(
    r.protocolVersion === 2 &&
      credentialIdentity(r.sidebarInstanceId) &&
      credentialIdentity(r.drawerId),
  );
  parseCredentialSource(r.sourceProfile);
  credentialAssert(credentialDecode(r.clientPublicKey, 65, 65)[0] === 4);
  return r as unknown as CredentialChannelOpen;
}
export function parseCredentialOffer(value: unknown): CredentialChannelOffer {
  const r = credentialRecord(value, [
    "protocolVersion",
    "sidebarInstanceId",
    "drawerId",
    "sourceProfile",
    "clientPublicKey",
    "senderId",
    "helperSessionId",
    "channelId",
    "helperPublicKey",
    "salt",
  ]);
  parseCredentialOpen(
    Object.fromEntries(
      ["protocolVersion", "sidebarInstanceId", "drawerId", "sourceProfile", "clientPublicKey"].map(
        (key) => [key, r[key]],
      ),
    ),
  );
  credentialAssert(
    credentialIdentity(r.senderId) &&
      credentialIdentity(r.helperSessionId) &&
      credentialIdentity(r.channelId),
  );
  credentialAssert(credentialDecode(r.helperPublicKey, 65, 65)[0] === 4);
  credentialDecode(r.salt, 32, 32);
  return r as unknown as CredentialChannelOffer;
}
export function credentialSourceArray(value: CredentialSourceProfile | null): unknown {
  return value === null
    ? null
    : [value.profileId, value.profileRevision, value.endpointFingerprint];
}
export function credentialKeyInfo(
  offer: CredentialChannelOffer,
  direction: CredentialDirection,
): Uint8Array {
  return credentialArray([
    "subtandem-channel",
    2,
    offer.helperSessionId,
    offer.sidebarInstanceId,
    offer.channelId,
    offer.senderId,
    offer.drawerId,
    direction,
  ]);
}
export function credentialHandshakeAAD(
  offer: CredentialChannelOffer,
  direction: CredentialDirection,
): Uint8Array {
  return credentialArray([
    "subtandem-channel-handshake",
    2,
    direction,
    offer.helperSessionId,
    offer.sidebarInstanceId,
    offer.channelId,
    offer.senderId,
    offer.drawerId,
    offer.clientPublicKey,
    offer.helperPublicKey,
    offer.salt,
    credentialSourceArray(offer.sourceProfile),
  ]);
}
export function credentialOperationAAD(
  offer: CredentialChannelOffer,
  direction: CredentialDirection,
  sequence: number,
  context: CredentialOperationContext,
): Uint8Array {
  return credentialArray([
    "subtandem-channel-operation",
    2,
    direction,
    offer.helperSessionId,
    offer.sidebarInstanceId,
    offer.channelId,
    offer.senderId,
    offer.drawerId,
    sequence,
    context.requestId,
    context.draftRevision,
    context.keyEditEpoch,
    context.submitEpoch,
    context.purpose,
    credentialSourceArray(context.sourceProfile),
    context.kind,
    context.endpointFingerprint,
    context.snapshotDigest,
    context.expiresAtMs,
  ]);
}
export function credentialNonce(sequence: number): Uint8Array {
  credentialAssert(credentialInteger(sequence));
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, Math.floor(sequence / 0x100000000), false);
  view.setUint32(8, sequence % 0x100000000, false);
  return bytes;
}
const PURPOSES = ["read-edit", "save-profile", "draft-test", "draft-models"];
const KINDS = ["openai", "claude", "deepseek", "ollama"];
export function parseCredentialContext(value: unknown): CredentialOperationContext {
  const r = credentialRecord(value, [
    "requestId",
    "draftRevision",
    "keyEditEpoch",
    "submitEpoch",
    "purpose",
    "sourceProfile",
    "kind",
    "endpointFingerprint",
    "snapshotDigest",
    "expiresAtMs",
  ]);
  credentialAssert(
    credentialIdentity(r.requestId) &&
      credentialInteger(r.draftRevision) &&
      credentialInteger(r.keyEditEpoch) &&
      credentialInteger(r.submitEpoch) &&
      PURPOSES.includes(String(r.purpose)) &&
      KINDS.includes(String(r.kind)) &&
      credentialIdentity(r.endpointFingerprint) &&
      typeof r.snapshotDigest === "string" &&
      /^[0-9a-f]{64}$/.test(r.snapshotDigest) &&
      credentialInteger(r.expiresAtMs, 1),
  );
  parseCredentialSource(r.sourceProfile);
  return r as unknown as CredentialOperationContext;
}
export function parseCredentialEnvelope(value: unknown): CredentialEnvelope {
  const r = credentialRecord(value, [
    "protocolVersion",
    "channelId",
    "helperSessionId",
    "sequence",
    "context",
    "snapshotBytes",
    "sealedPayload",
  ]);
  credentialAssert(
    r.protocolVersion === 2 &&
      credentialIdentity(r.channelId) &&
      credentialIdentity(r.helperSessionId) &&
      credentialInteger(r.sequence, 1, CREDENTIAL_LIMITS.messages - 1),
  );
  parseCredentialContext(r.context);
  credentialDecode(r.snapshotBytes, CREDENTIAL_LIMITS.documentBytes);
  credentialAssert(credentialDecode(r.sealedPayload, CREDENTIAL_LIMITS.sealedBytes).length >= 16);
  credentialAssert(
    credentialUtf8(JSON.stringify(r)).length <= CREDENTIAL_LIMITS.requestBytes,
    "credential-too-large",
  );
  return r as unknown as CredentialEnvelope;
}
export function parseCredentialSnapshot(value: unknown): CredentialOperationSnapshot {
  const r = credentialRecord(value, [
    "kind",
    "endpoint",
    "model",
    "proxyMode",
    "purpose",
    "sourceProfile",
    "save",
  ]);
  credentialAssert(
    KINDS.includes(String(r.kind)) &&
      typeof r.endpoint === "string" &&
      /^https?:\/\//.test(r.endpoint) &&
      r.endpoint.length <= 8192 &&
      (r.model === null || (typeof r.model === "string" && r.model.length <= 1024)) &&
      ["system", "direct"].includes(String(r.proxyMode)) &&
      PURPOSES.includes(String(r.purpose)),
  );
  parseCredentialSource(r.sourceProfile);
  if (r.purpose === "save-profile") {
    const save = credentialRecord(r.save, [
      "commitId",
      "expectedStoreRevision",
      "expectedProfileRevision",
      "profileState",
    ]);
    credentialAssert(
      credentialIdentity(save.commitId) &&
        credentialInteger(save.expectedStoreRevision) &&
        (save.expectedProfileRevision === null ||
          credentialInteger(save.expectedProfileRevision, 1)),
    );
    const state = credentialRecord(save.profileState, ["profiles", "activation"]);
    credentialAssert(Array.isArray(state.profiles) && state.profiles.length <= 1024);
    const ids = new Set<string>();
    for (const value of state.profiles) {
      const p = credentialRecord(
        value,
        [
          "profileId",
          "revision",
          "displayName",
          "kind",
          "endpoint",
          "endpointFingerprint",
          "proxyMode",
        ],
        ["model", "capability"],
      );
      credentialAssert(
        credentialIdentity(p.profileId) &&
          !ids.has(p.profileId) &&
          credentialInteger(p.revision, 1) &&
          typeof p.displayName === "string" &&
          p.displayName.length > 0 &&
          p.displayName.length <= 128 &&
          KINDS.includes(String(p.kind)) &&
          typeof p.endpoint === "string" &&
          /^https?:\/\//.test(p.endpoint) &&
          p.endpoint.length <= 8192 &&
          credentialIdentity(p.endpointFingerprint) &&
          ["system", "direct"].includes(String(p.proxyMode)) &&
          (p.model === undefined || (typeof p.model === "string" && p.model.length <= 1024)) &&
          (p.capability === undefined ||
            ["strict-json-schema", "json-object", "prompt-json"].includes(String(p.capability))),
      );
      ids.add(p.profileId);
    }
    if (state.activation !== null) {
      const a = credentialRecord(state.activation, [
        "profileId",
        "profileRevision",
        "kind",
        "endpointFingerprint",
        "credentialConfigured",
      ]);
      parseCredentialSource({
        profileId: a.profileId,
        profileRevision: a.profileRevision,
        endpointFingerprint: a.endpointFingerprint,
      });
      credentialAssert(
        KINDS.includes(String(a.kind)) &&
          typeof a.credentialConfigured === "boolean" &&
          state.profiles.some(
            (p: Record<string, unknown>) =>
              p.profileId === a.profileId &&
              p.revision === a.profileRevision &&
              p.kind === a.kind &&
              p.endpointFingerprint === a.endpointFingerprint,
          ),
      );
    }
  } else credentialAssert(r.save === null);
  return r as unknown as CredentialOperationSnapshot;
}
export function parseCredentialHandshake(value: unknown): CredentialHandshake {
  const r = credentialRecord(value, [
    "protocolVersion",
    "channelId",
    "helperSessionId",
    "sequence",
    "sealedPayload",
  ]);
  credentialAssert(
    r.protocolVersion === 2 &&
      credentialIdentity(r.channelId) &&
      credentialIdentity(r.helperSessionId) &&
      r.sequence === 0,
  );
  credentialDecode(r.sealedPayload, 16, 16);
  return r as unknown as CredentialHandshake;
}
