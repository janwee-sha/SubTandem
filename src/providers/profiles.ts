import "../../shared/provider-endpoint.js";
export const { normalizeProviderEndpoint, sameProviderService } = (
  globalThis as typeof globalThis & { subtandemProviderEndpoint: SubtandemProviderEndpointApi }
).subtandemProviderEndpoint;
import { identityHash } from "../domain/identity.js";
import type { EndpointFingerprint, PersistentProviderProfile, ProfileId } from "../domain/types.js";
import type { ProviderProfileSnapshot } from "./types.js";

type Kind = "openai" | "claude" | "deepseek" | "ollama";

export function normalizeLegacyProviderProfiles(value: unknown): ProviderProfileSnapshot[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "string") throw new Error("LEGACY_METADATA_UNAVAILABLE");
  const input: unknown = JSON.parse(value);
  if (!Array.isArray(input)) throw new Error("LEGACY_METADATA_UNAVAILABLE");
  const profiles = new ProviderProfiles(() => {
    throw new Error("LEGACY_ID_REQUIRED");
  });
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("LEGACY_METADATA_UNAVAILABLE");
    const record = item as Record<string, unknown>;
    if (
      typeof record.profileId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.profileId) ||
      ids.has(record.profileId) ||
      typeof record.displayName !== "string" ||
      !record.displayName.trim() ||
      typeof record.endpoint !== "string" ||
      typeof record.model !== "string" ||
      !record.model.trim() ||
      !["openai", "claude", "deepseek", "ollama"].includes(String(record.kind)) ||
      (record.proxyMode !== undefined &&
        record.proxyMode !== "direct" &&
        record.proxyMode !== "system") ||
      (record.capability !== undefined &&
        !["strict-json-schema", "json-object", "prompt-json"].includes(String(record.capability)))
    )
      throw new Error("LEGACY_METADATA_UNAVAILABLE");
    ids.add(record.profileId);
    profiles.save({
      profileId: record.profileId,
      expectedRevision: 0,
      displayName: record.displayName,
      kind: record.kind as Kind,
      endpoint: record.endpoint,
      model: record.model,
      proxyMode: record.proxyMode === "direct" ? "direct" : "system",
      ...(record.kind === "openai" && record.capability
        ? { capability: record.capability as NonNullable<SaveProfileInput["capability"]> }
        : {}),
    });
  }
  return profiles.listLatest();
}

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

function fingerprint(
  kind: Kind,
  endpoint: string,
  proxyMode: "system" | "direct",
): EndpointFingerprint {
  return identityHash({ kind, endpoint, proxyMode }) as unknown as EndpointFingerprint;
}

function cloneProfile(profile: PersistentProviderProfile): ProviderProfileSnapshot {
  return {
    profileId: profile.profileId,
    revision: profile.revision,
    displayName: profile.displayName,
    kind: profile.kind,
    endpoint: profile.endpoint,
    endpointFingerprint: profile.endpointFingerprint,
    proxyMode: profile.proxyMode ?? "system",
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(profile.capability === undefined ? {} : { capability: profile.capability }),
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
