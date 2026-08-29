import { identityHash } from "../domain/identity.js";
import type { EndpointFingerprint, ProfileId } from "../domain/types.js";
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

export interface WindowSelection {
  profileId: string;
  revision: number;
  endpointFingerprint: string;
  kind: Kind;
  authorizedAt: number;
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

export class ProviderProfiles {
  private readonly revisions = new Map<string, Map<number, ProviderProfileSnapshot>>();
  private readonly latest = new Map<string, number>();
  private readonly selections = new Map<string, WindowSelection>();
  private readonly leases = new Set<string>();
  private collisionSequence = 0;

  constructor(private readonly id: () => string) {}

  save(input: SaveProfileInput): ProviderProfileSnapshot {
    const generated = input.profileId ?? this.id();
    const profileId =
      input.profileId || !this.revisions.has(generated)
        ? generated
        : `${generated}-${++this.collisionSequence}`;
    const latestRevision = this.latest.get(profileId) ?? 0;
    if (input.profileId && input.expectedRevision !== latestRevision)
      throw new Error("STALE_PROFILE_REVISION");
    const endpoint = normalizeProviderEndpoint(input.kind, input.endpoint);
    if (!input.model?.trim()) throw new Error("MODEL_REQUIRED");
    const revision = latestRevision + 1;
    const endpointFingerprint = identityHash({
      kind: input.kind,
      endpoint,
      proxyMode: input.proxyMode ?? "system",
    }) as unknown as EndpointFingerprint;
    const snapshot: ProviderProfileSnapshot = {
      profileId: profileId as ProfileId,
      revision,
      displayName: input.displayName.trim() || `${input.kind} ${revision}`,
      kind: input.kind,
      endpoint,
      endpointFingerprint,
      proxyMode: input.proxyMode ?? "system",
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      ...(input.capability ? { capability: input.capability } : {}),
    };
    const profileRevisions = this.revisions.get(profileId) ?? new Map();
    profileRevisions.set(revision, snapshot);
    this.revisions.set(profileId, profileRevisions);
    this.latest.set(profileId, revision);
    if (
      input.editingWindowId &&
      input.profileId &&
      this.selections.get(input.editingWindowId)?.profileId === input.profileId
    )
      this.selections.delete(input.editingWindowId);
    return snapshot;
  }

  get(profileId: string, revision?: number): ProviderProfileSnapshot | null {
    const resolvedRevision = revision ?? this.latest.get(profileId);
    return resolvedRevision === undefined
      ? null
      : (this.revisions.get(profileId)?.get(resolvedRevision) ?? null);
  }

  listLatest(): ProviderProfileSnapshot[] {
    return [...this.latest].flatMap(([profileId, revision]) => {
      const profile = this.get(profileId, revision);
      return profile ? [profile] : [];
    });
  }

  select(
    windowId: string,
    profileId: string,
    revision: number,
    endpointFingerprint: string,
  ): WindowSelection {
    const profile = this.get(profileId, revision);
    if (!profile || profile.endpointFingerprint !== endpointFingerprint)
      throw new Error("SELECTION_MISMATCH");
    const selection = {
      profileId,
      revision,
      endpointFingerprint,
      kind: profile.kind,
      authorizedAt: Date.now(),
    };
    this.selections.set(windowId, selection);
    return selection;
  }

  selection(windowId: string): WindowSelection | null {
    return this.selections.get(windowId) ?? null;
  }

  lease(windowId: string, profileId: string, revision: number): void {
    if (!this.get(profileId, revision)) throw new Error("PROFILE_NOT_FOUND");
    this.leases.add(`${windowId}\u0000${profileId}\u0000${revision}`);
  }

  release(windowId: string, profileId: string, revision: number): void {
    this.leases.delete(`${windowId}\u0000${profileId}\u0000${revision}`);
  }

  delete(profileId: string): string[] {
    if (!this.revisions.has(profileId)) throw new Error("PROFILE_NOT_FOUND");
    const affected = new Set<string>();
    for (const [windowId, selection] of this.selections) {
      if (selection.profileId !== profileId) continue;
      affected.add(windowId);
      this.selections.delete(windowId);
    }
    for (const lease of [...this.leases]) {
      const [windowId, leasedProfileId] = lease.split("\u0000");
      if (leasedProfileId !== profileId) continue;
      if (windowId) affected.add(windowId);
      this.leases.delete(lease);
    }
    this.latest.delete(profileId);
    this.revisions.delete(profileId);
    return [...affected].sort();
  }

  clearAuthorizations(): string[] {
    const windowIds = new Set(this.selections.keys());
    for (const lease of this.leases) windowIds.add(lease.split("\u0000", 1)[0]!);
    this.selections.clear();
    this.leases.clear();
    return [...windowIds].sort();
  }
}
