import { identityHash } from "../domain/identity.js";
import type { EndpointFingerprint, PersistentProviderProfile, ProfileId } from "../domain/types.js";
import type { ProviderProfileSnapshot } from "./types.js";

type Kind = "openai" | "claude" | "deepseek" | "ollama";

export interface SaveProfileInput {
  profileId?: string;
  expectedRevision?: number;
  editingWindowId?: string;
  displayName: string;
  kind: Kind;
  endpoint: string;
  proxyMode?: "system" | "direct";
  model?: string;
  capability?: "strict-json-schema" | "json-object" | "prompt-json";
}

function invalidEndpoint(): never {
  throw new Error("INVALID_ENDPOINT");
}

function validatePort(value: string): void {
  if (!/^\d+$/.test(value)) invalidEndpoint();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) invalidEndpoint();
}

function validateIpv6Host(value: string): void {
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) invalidEndpoint();
  const compression = value.indexOf("::");
  if (compression !== value.lastIndexOf("::")) invalidEndpoint();
  const groups = value.split(":").filter(Boolean);
  if (groups.some((group) => group.length > 4)) invalidEndpoint();
  if ((compression === -1 && groups.length !== 8) || (compression !== -1 && groups.length >= 8))
    invalidEndpoint();
}

function validateAuthority(authority: string): void {
  if (!authority || /\s|@/.test(authority)) invalidEndpoint();
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 2 || authority.indexOf("]", close + 1) !== -1) invalidEndpoint();
    validateIpv6Host(authority.slice(1, close));
    const suffix = authority.slice(close + 1);
    if (!suffix) return;
    if (!suffix.startsWith(":")) invalidEndpoint();
    validatePort(suffix.slice(1));
    return;
  }
  if (authority.includes("[") || authority.includes("]")) invalidEndpoint();
  const separator = authority.lastIndexOf(":");
  const host = separator === -1 ? authority : authority.slice(0, separator);
  if (!host || host.includes(":")) invalidEndpoint();
  if (separator !== -1) validatePort(authority.slice(separator + 1));
}

export function normalizeProviderEndpoint(kind: Kind, value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i);
  if (!match || /[?#]/.test(trimmed)) invalidEndpoint();
  const scheme = match[1]!.toLowerCase();
  const authority = match[2]!;
  validateAuthority(authority);
  if (kind === "openai") return trimmed;
  const path = (match[3] ?? "").replace(/\/+$/, "");
  if (kind === "claude" && /\/v1\/(?:messages|models)$/i.test(path)) invalidEndpoint();
  return `${scheme}://${authority.toLowerCase()}${path}`;
}

function fingerprint(
  kind: Kind,
  endpoint: string,
  proxyMode: "system" | "direct",
): EndpointFingerprint {
  return identityHash({ kind, endpoint, proxyMode }) as unknown as EndpointFingerprint;
}

function cloneProfile(profile: PersistentProviderProfile): ProviderProfileSnapshot {
  return {
    ...profile,
    proxyMode: profile.proxyMode ?? "system",
  };
}

function validateStoredProfile(profile: PersistentProviderProfile): ProviderProfileSnapshot {
  if (
    !profile.profileId ||
    !Number.isSafeInteger(profile.revision) ||
    profile.revision < 1 ||
    !profile.displayName.trim() ||
    !profile.model?.trim()
  )
    throw new Error("INVALID_PROFILE");
  const endpoint = normalizeProviderEndpoint(profile.kind, profile.endpoint);
  if (endpoint !== profile.endpoint) throw new Error("PROFILE_ENDPOINT_MISMATCH");
  const proxyMode = profile.proxyMode ?? "system";
  if (profile.endpointFingerprint !== fingerprint(profile.kind, endpoint, proxyMode))
    throw new Error("PROFILE_FINGERPRINT_MISMATCH");
  return cloneProfile(profile);
}

export class ProviderProfiles {
  private latest = new Map<string, ProviderProfileSnapshot>();

  constructor(private readonly id: () => string) {}

  createSaveCandidate(input: SaveProfileInput): ProviderProfileSnapshot {
    const profileId = input.profileId ?? this.id();
    const current = this.latest.get(profileId);
    if (!input.profileId && current) throw new Error("PROFILE_ID_COLLISION");
    const expectedRevision = current?.revision ?? 0;
    if (input.profileId && input.expectedRevision !== expectedRevision)
      throw new Error("STALE_PROFILE_REVISION");
    const revision = expectedRevision + 1;
    if (!Number.isSafeInteger(revision)) throw new Error("PROFILE_REVISION_EXHAUSTED");
    const endpoint = normalizeProviderEndpoint(input.kind, input.endpoint);
    const model = input.model?.trim();
    if (!model) throw new Error("MODEL_REQUIRED");
    const proxyMode = input.proxyMode ?? "system";
    return {
      profileId: profileId as ProfileId,
      revision,
      displayName: input.displayName.trim() || `${input.kind} ${revision}`,
      kind: input.kind,
      endpoint,
      endpointFingerprint: fingerprint(input.kind, endpoint, proxyMode),
      proxyMode,
      model,
      ...(input.capability ? { capability: input.capability } : {}),
    };
  }

  commitCandidate(candidate: PersistentProviderProfile): ProviderProfileSnapshot {
    const validated = validateStoredProfile(candidate);
    const current = this.latest.get(validated.profileId);
    if (validated.revision !== (current?.revision ?? 0) + 1)
      throw new Error("STALE_PROFILE_REVISION");
    this.latest.set(validated.profileId, validated);
    return cloneProfile(validated);
  }

  save(input: SaveProfileInput): ProviderProfileSnapshot {
    return this.commitCandidate(this.createSaveCandidate(input));
  }

  hydrate(profiles: readonly PersistentProviderProfile[]): void {
    const replacement = new Map<string, ProviderProfileSnapshot>();
    for (const profile of profiles) {
      const validated = validateStoredProfile(profile);
      if (replacement.has(validated.profileId)) throw new Error("DUPLICATE_PROFILE");
      replacement.set(validated.profileId, validated);
    }
    this.latest = replacement;
  }

  get(profileId: string, revision?: number): ProviderProfileSnapshot | null {
    const profile = this.latest.get(profileId);
    if (!profile || (revision !== undefined && revision !== profile.revision)) return null;
    return cloneProfile(profile);
  }

  listLatest(): ProviderProfileSnapshot[] {
    return [...this.latest.values()].map(cloneProfile);
  }

  delete(profileId: string, expectedRevision?: number): ProviderProfileSnapshot {
    const profile = this.latest.get(profileId);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");
    if (expectedRevision !== undefined && expectedRevision !== profile.revision)
      throw new Error("STALE_PROFILE_REVISION");
    this.latest.delete(profileId);
    return cloneProfile(profile);
  }
}
