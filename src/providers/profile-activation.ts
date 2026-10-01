import { withinProfileDeadline } from "../transport/deadline.js";
import {
  CREDENTIAL_LIMITS,
  credentialIdentity,
  type CredentialSourceProfile,
} from "../../shared/credential-protocol.js";
import { canonicalJson } from "../domain/identity.js";
import { profileSaveRequestDigest, validateProfileSave } from "../transport/client.js";
import { SubTandemError } from "../domain/errors.js";
import type {
  ActivationReference,
  AuthorityProfile,
  AuthoritySnapshot,
  ProfileActivationResult,
  ProfileState,
} from "../domain/types.js";
import type { ProfileStateCommitResult, ProfileStateStoreSnapshot } from "../transport/client.js";
import type { ProviderProfiles } from "./profiles.js";
import type { SaveProfileInput } from "./profiles.js";
import type { ProviderProfileSnapshot } from "./types.js";
import type { CredentialEnvelope, CredentialOwner } from "../../shared/credential-protocol.js";

export interface ProfileSaveReservation {
  reservationId: string;
  owner: CredentialOwner;
  requestId: string;
  expiresAtMs: number;
  commitId: string;
  expectedStoreRevision: number;
  expectedProfileRevision: number | null;
  profile: ProviderProfileSnapshot;
  profileState: ProfileState;
  sourceProfile: CredentialSourceProfile | null;
}

export interface ProfileActivationSetInput {
  senderId: string;
  requestId: string;
  authorityId: string;
  profileId: string;
  profileRevision: number;
  endpointFingerprint: string;
  enabled: boolean;
}

export interface ProfileActivationCommitInput {
  commitId: string;
  expectedStoreRevision: number;
  profileState: ProfileState;
}

export interface ProfileActivationStore {
  migrate?(
    commitId: string,
    profiles?: ProfileState["profiles"],
  ): Promise<ProfileStateCommitResult>;
  cleanup?(
    commitId: string,
    migrationId: string,
    preferenceConfirmed: boolean,
  ): Promise<ProfileStateCommitResult>;
  read(deadlineMs?: number): Promise<ProfileStateStoreSnapshot>;
  recover?(commitId: string, expiresAtMs: number): Promise<ProfileStateCommitResult>;
  open(commitId: string): Promise<ProfileStateCommitResult>;
  initialize(
    commitId: string,
    expectedStoreRevision: number,
    profiles: ProfileState["profiles"],
  ): Promise<ProfileStateCommitResult>;
  commit(
    commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult>;
}

interface ProfileActivationAuthorityOptions {
  authorityId: string;
  profiles: ProviderProfiles;
  storeRevision: number;
  credentialConfigured: Record<string, boolean>;
  activation: ActivationReference | null;
  ready?: boolean;
  fallbackEntered?: boolean;
  stateVersion?: number;
  activationGeneration?: number;
  commit(input: ProfileActivationCommitInput): Promise<ProfileStateCommitResult>;
  createCommitId(): string;
  recover?(commitId: string): Promise<ProfileStateCommitResult>;
}

export type ProfileMutationResult =
  | {
      outcome: "changed";
      authority: AuthoritySnapshot;
      profile?: ProviderProfileSnapshot;
    }
  | {
      outcome: "failed" | "pending";
      authority: AuthoritySnapshot;
    };

function sameActivation(
  left: ActivationReference | null,
  right: ActivationReference | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.profileId === right.profileId &&
    left.profileRevision === right.profileRevision &&
    left.kind === right.kind &&
    left.endpointFingerprint === right.endpointFingerprint &&
    left.credentialConfigured === right.credentialConfigured
  );
}

function sameProfile(
  left: ProfileState["profiles"][number],
  right: ProfileState["profiles"][number],
): boolean {
  return (
    left.profileId === right.profileId &&
    left.revision === right.revision &&
    left.displayName === right.displayName &&
    left.kind === right.kind &&
    left.endpoint === right.endpoint &&
    left.endpointFingerprint === right.endpointFingerprint &&
    left.proxyMode === right.proxyMode &&
    left.model === right.model &&
    left.capability === right.capability
  );
}

function sameProfiles(left: ProfileState["profiles"], right: ProfileState["profiles"]): boolean {
  return (
    left.length === right.length &&
    left.every((profile, index) => sameProfile(profile, right[index]!))
  );
}

function persistentProfiles(profiles: ProviderProfiles): ProfileState["profiles"] {
  return profiles.listLatest().map((profile) => {
    const stored = { ...profile };
    delete stored.modelCatalog;
    return stored;
  });
}

function safeError(requestId: string, authority: AuthoritySnapshot): ProfileActivationResult {
  return {
    requestId,
    outcome: "failed",
    authority,
    error: {
      code: "PROFILE_ACTIVATION_FAILED",
      userAction: "RETRY",
    },
  };
}

function validRestoredActivation(
  snapshot: ProfileStateStoreSnapshot,
  activation: ActivationReference | null,
): boolean {
  if (!activation) return true;
  const profile = snapshot.profileState?.profiles.find(
    (candidate) => candidate.profileId === activation.profileId,
  );
  const configured = snapshot.credentialConfigured[activation.profileId] ?? false;
  return Boolean(
    profile &&
    profile.revision === activation.profileRevision &&
    profile.kind === activation.kind &&
    profile.endpointFingerprint === activation.endpointFingerprint &&
    activation.credentialConfigured === configured,
  );
}

export async function restoreProfileActivationAuthority(options: {
  authorityId: string;
  profiles: ProviderProfiles;
  store: ProfileActivationStore;
  createCommitId(): string;
  deadlineMs?: number;
  loadLegacyProfiles?(required?: boolean): ProfileState["profiles"];
  clearLegacyPreferences?(): boolean;
}): Promise<ProfileActivationAuthority> {
  const load = async (
    commitId: string,
    deadlineMs: number,
    acceptReadable?: (result: ProfileStateCommitResult) => void,
  ): Promise<ProfileStateCommitResult> => {
    const bounded = <T>(operation: Promise<T>) => withinProfileDeadline(operation, deadlineMs);
    let restored: ProfileStateCommitResult;
    try {
      const current = await bounded(options.store.read(deadlineMs));
      if (current.initialized) restored = { state: "committed", ...current };
      else
        restored = options.store.recover
          ? await bounded(options.store.recover(commitId, deadlineMs))
          : await bounded(options.store.initialize(commitId, current.storeRevision, []));
    } catch (error) {
      if (
        error instanceof SubTandemError &&
        options.store.migrate &&
        ["LEGACY_PREFERENCES_REQUIRED", "LEGACY_PROFILE_STATE_REQUIRED"].includes(error.code)
      ) {
        const legacy =
          error.code === "LEGACY_PREFERENCES_REQUIRED"
            ? options.loadLegacyProfiles?.(true)
            : undefined;
        if (error.code === "LEGACY_PREFERENCES_REQUIRED" && legacy === undefined) throw error;
        restored = await bounded(options.store.migrate(commitId, legacy));
      } else {
        if (!options.store.recover || Date.now() >= deadlineMs) throw error;
        restored = await bounded(options.store.recover(commitId, deadlineMs));
      }
    }
    if (!restored.profileState) throw new Error("PROFILE_STATE_UNAVAILABLE");
    if (
      restored.invalidActivation === true ||
      !validRestoredActivation(restored, restored.profileState.activation)
    ) {
      const sanitized = { profiles: restored.profileState.profiles, activation: null };
      const readable = { ...restored, profileState: sanitized };
      delete readable.invalidActivation;
      acceptReadable?.(readable);
      try {
        restored = await bounded(
          options.store.commit(options.createCommitId(), restored.storeRevision, sanitized),
        );
      } catch {
        restored = { ...restored, profileState: sanitized };
        delete restored.invalidActivation;
      }
    }
    acceptReadable?.(restored);
    return restored;
  };
  const deadlineMs = options.deadlineMs ?? Date.now() + 15_000;
  let restored: ProfileStateCommitResult | null = null;
  let readable: ProfileStateCommitResult | null = null;
  try {
    restored = await withinProfileDeadline(
      load(options.createCommitId(), deadlineMs, (result) => {
        readable = result;
      }),
      deadlineMs,
    );
  } catch (error) {
    void error;
    restored = readable;
  }
  const ready = restored?.state === "committed" && restored.profileState !== null;
  options.profiles.hydrate(ready ? restored!.profileState!.profiles : []);
  const authority = new ProfileActivationAuthority({
    authorityId: options.authorityId,
    profiles: options.profiles,
    storeRevision: ready ? restored!.storeRevision : 0,
    credentialConfigured: ready ? restored!.credentialConfigured : {},
    activation: ready ? restored!.profileState!.activation : null,
    activationGeneration: 0,
    ready,
    fallbackEntered: !ready,
    commit: (input) =>
      options.store.commit(input.commitId, input.expectedStoreRevision, input.profileState),
    createCommitId: options.createCommitId,
    recover: (commitId) => load(commitId, Date.now() + 15_000),
  });
  if (ready && restored?.migration?.cleanupState === "pending" && options.store.cleanup) {
    const migration = restored.migration;
    const preferenceConfirmed =
      !migration.pendingClasses.includes("legacy-preferences") ||
      options.clearLegacyPreferences?.() === true;
    void authority.maintain(
      () =>
        options.store.cleanup!(
          options.createCommitId(),
          migration.migrationId,
          preferenceConfirmed,
        ),
      deadlineMs,
    );
  }
  return authority;
}

export class ProfileActivationAuthority {
  private readonly authorityId: string;
  private readonly profiles: ProviderProfiles;
  private readonly commit: (
    input: ProfileActivationCommitInput,
  ) => Promise<ProfileStateCommitResult>;
  private readonly createCommitId: () => string;
  private readonly credentialConfigured = new Map<string, boolean>();
  private readonly pendingBySender = new Map<string, string>();
  private readonly requests = new Map<string, Promise<ProfileActivationResult>>();
  private readonly reservations = new Map<
    string,
    { reservation: ProfileSaveReservation; input: string }
  >();
  private tail: Promise<void> = Promise.resolve();
  private storeRevision: number;
  private stateVersion: number;
  private activationGeneration: number;
  private activation: ActivationReference | null;
  private ready: boolean;
  private readonly fallbackEntered: boolean;
  private recoveryGeneration = 0;
  private committing = false;
  private reconciling = false;
  private recoveryCommitId: string | null = null;
  private readonly recover: ((commitId: string) => Promise<ProfileStateCommitResult>) | undefined;

  constructor(options: ProfileActivationAuthorityOptions) {
    this.authorityId = options.authorityId;
    this.profiles = options.profiles;
    this.storeRevision = options.storeRevision;
    this.credentialConfigured = new Map(Object.entries(options.credentialConfigured));
    this.activation = options.activation ? { ...options.activation } : null;
    this.ready = options.ready ?? true;
    this.fallbackEntered = options.fallbackEntered ?? !this.ready;
    this.stateVersion = options.stateVersion ?? 0;
    this.activationGeneration =
      options.activationGeneration ?? (options.activation === null ? 0 : 1);
    this.commit = options.commit;
    this.createCommitId = options.createCommitId;
    this.recover = options.recover;
  }

  get snapshot(): AuthoritySnapshot {
    return {
      authorityId: this.authorityId,
      stateVersion: this.stateVersion,
      ready: this.ready,
      activationGeneration: this.activationGeneration,
      activation:
        this.fallbackEntered && this.activationGeneration === 0
          ? null
          : this.activation
            ? { ...this.activation }
            : null,
      profiles: this.profiles.listLatest().map((profile): AuthorityProfile => {
        const safe = { ...profile };
        delete safe.modelCatalog;
        return {
          ...safe,
          proxyMode: safe.proxyMode ?? "system",
          credentialConfigured: this.credentialConfigured.get(profile.profileId) ?? false,
          ...(profile.modelCatalog
            ? {
                modelCatalog: {
                  contextKey: profile.modelCatalog.contextKey,
                  models: [...profile.modelCatalog.models],
                },
              }
            : {}),
        };
      }),
    };
  }

  get acceptsTranslations(): boolean {
    return this.ready && !this.committing && !this.reconciling && this.snapshot.activation !== null;
  }

  isAuthorized(input: {
    authorityId: string;
    activationGeneration: number;
    profileId: string;
    profileRevision: number;
    endpointFingerprint: string;
  }): boolean {
    const activation = this.activation;
    return Boolean(
      this.acceptsTranslations &&
      input.authorityId === this.authorityId &&
      input.activationGeneration === this.activationGeneration &&
      activation &&
      input.profileId === activation.profileId &&
      input.profileRevision === activation.profileRevision &&
      input.endpointFingerprint === activation.endpointFingerprint,
    );
  }

  set(input: ProfileActivationSetInput): Promise<ProfileActivationResult> {
    const key = `${input.senderId}\u0000${input.requestId}`;
    const duplicate = this.requests.get(key);
    if (duplicate) return duplicate;
    if (this.pendingBySender.has(input.senderId) || this.reconciling || !this.ready) {
      const pending = Promise.resolve({
        requestId: input.requestId,
        outcome: "pending" as const,
        authority: this.snapshot,
      });
      this.requests.set(key, pending);
      return pending;
    }
    this.pendingBySender.set(input.senderId, input.requestId);
    const operation = this.tail.then(() => this.execute(input));
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    const result = operation.finally(() => {
      if (this.pendingBySender.get(input.senderId) === input.requestId)
        this.pendingBySender.delete(input.senderId);
    });
    this.requests.set(key, result);
    return result;
  }

  reserveProfileSave(
    input: SaveProfileInput,
    owner: CredentialOwner,
    requestId: string,
  ): Promise<ProfileSaveReservation> {
    const operation = this.tail.then(async () => {
      if (!this.ready || this.reconciling) await this.verifyBase();
      if (
        !this.ready ||
        this.reconciling ||
        !credentialIdentity(requestId) ||
        ![owner.senderId, owner.sidebarInstanceId, owner.drawerId].every(credentialIdentity)
      )
        throw new Error("PROFILE_SAVE_UNAVAILABLE");
      const now = Date.now();
      const inputBytes = canonicalJson(input);
      for (const [id, entry] of this.reservations) {
        if (entry.reservation.expiresAtMs <= now) {
          this.reservations.delete(id);
          continue;
        }
        if (canonicalJson(entry.reservation.owner) !== canonicalJson(owner)) continue;
        if (entry.reservation.requestId === requestId) {
          if (entry.input !== inputBytes) throw new Error("PROFILE_SAVE_CONFLICT");
          return JSON.parse(JSON.stringify(entry.reservation)) as ProfileSaveReservation;
        }
        this.reservations.delete(id);
      }
      if (this.reservations.size >= 64) throw new Error("PROFILE_SAVE_UNAVAILABLE");
      const candidate = this.profiles.createSaveCandidate(input);
      const previous = this.profiles.get(candidate.profileId);
      const profiles = persistentProfiles(this.profiles);
      const index = profiles.findIndex((profile) => profile.profileId === candidate.profileId);
      if (index === -1) profiles.unshift(candidate);
      else profiles[index] = candidate;
      const reservation: ProfileSaveReservation = {
        reservationId: this.createCommitId(),
        owner: { ...owner },
        requestId,
        expiresAtMs: now + Math.min(60_000, CREDENTIAL_LIMITS.idleMs),
        commitId: this.createCommitId(),
        expectedStoreRevision: this.storeRevision,
        expectedProfileRevision: previous?.revision ?? null,
        profile: { ...candidate },
        profileState: {
          profiles,
          activation:
            this.activation?.profileId === candidate.profileId
              ? null
              : this.activation
                ? { ...this.activation }
                : null,
        },
        sourceProfile: previous
          ? {
              profileId: previous.profileId,
              profileRevision: previous.revision,
              endpointFingerprint: previous.endpointFingerprint,
            }
          : null,
      };
      this.reservations.set(reservation.reservationId, { reservation, input: inputBytes });
      return JSON.parse(JSON.stringify(reservation)) as ProfileSaveReservation;
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  completeProfileSave(
    reservationId: string,
    owner: CredentialOwner,
    frame: CredentialEnvelope,
    save: (owner: CredentialOwner, frame: CredentialEnvelope) => Promise<ProfileStateCommitResult>,
  ): Promise<ProfileMutationResult> {
    return this.enqueueMutation(async () => {
      const reservation = this.reservations.get(reservationId)?.reservation;
      if (!reservation || canonicalJson(reservation.owner) !== canonicalJson(owner))
        return { outcome: "failed", authority: this.snapshot };
      this.reservations.delete(reservationId);
      try {
        const snapshot = validateProfileSave(owner, frame);
        if (
          reservation.expiresAtMs <= Date.now() ||
          this.storeRevision !== reservation.expectedStoreRevision ||
          frame.context.requestId !== reservation.requestId ||
          frame.context.expiresAtMs > reservation.expiresAtMs ||
          frame.context.expiresAtMs <= Date.now() ||
          frame.context.kind !== reservation.profile.kind ||
          frame.context.endpointFingerprint !== reservation.profile.endpointFingerprint ||
          snapshot.endpoint !== reservation.profile.endpoint ||
          snapshot.model !== reservation.profile.model ||
          snapshot.proxyMode !== reservation.profile.proxyMode ||
          canonicalJson(snapshot.sourceProfile) !== canonicalJson(reservation.sourceProfile) ||
          canonicalJson(snapshot.save) !==
            canonicalJson({
              commitId: reservation.commitId,
              expectedStoreRevision: reservation.expectedStoreRevision,
              expectedProfileRevision: reservation.expectedProfileRevision,
              profileState: reservation.profileState,
            })
        )
          return { outcome: "failed", authority: this.snapshot };
      } catch {
        return { outcome: "failed", authority: this.snapshot };
      }
      const previousActivation = this.activation ? { ...this.activation } : null;
      this.beginCommit();
      try {
        const result = await save(owner, frame);
        if (
          result.state === "reconciling" ||
          !this.matchesState(result, reservation.profileState) ||
          result.lastCommit?.commitId !== reservation.commitId ||
          result.lastCommit.operation !== "save-profile" ||
          result.lastCommit.baseRevision !== reservation.expectedStoreRevision ||
          result.lastCommit.requestDigest !== profileSaveRequestDigest(owner, frame)
        ) {
          this.enterReconciliation(previousActivation);
          return { outcome: "pending", authority: this.snapshot };
        }
        this.applyCommitted(result);
        if (!sameActivation(previousActivation, this.activation)) this.activationGeneration += 1;
        this.finishCommit();
        return {
          outcome: "changed",
          authority: this.snapshot,
          profile: this.profiles.get(reservation.profile.profileId, reservation.profile.revision)!,
        };
      } catch (error) {
        if (
          error instanceof SubTandemError &&
          [
            "PROFILE_STATE_CONFLICT",
            "INVALID_PROFILE_STATE",
            "CREDENTIAL_HARDWARE_UNAVAILABLE",
            "CREDENTIAL_OPERATION_REJECTED",
          ].includes(error.code)
        ) {
          this.failCommit(previousActivation);
          return { outcome: "failed", authority: this.snapshot };
        }
        this.enterReconciliation(previousActivation);
        return { outcome: "pending", authority: this.snapshot };
      } finally {
        this.committing = false;
      }
    });
  }

  private async verifyBase(): Promise<boolean> {
    if ((this.ready && !this.reconciling) || !this.recover) return false;
    this.recoveryCommitId ??= this.createCommitId();
    const generation = ++this.recoveryGeneration;
    const version = this.stateVersion;
    const wasReconciling = this.reconciling;
    const previous = this.activation;
    try {
      const result = await withinProfileDeadline(
        this.recover(this.recoveryCommitId),
        Date.now() + 15_000,
      );
      if (
        generation !== this.recoveryGeneration ||
        version !== this.stateVersion ||
        result.state !== "committed" ||
        !result.initialized ||
        !result.profileState ||
        result.storeRevision < this.storeRevision ||
        result.invalidActivation === true ||
        !validRestoredActivation(result, result.profileState.activation)
      )
        return false;
      this.applyCommitted(result);
      if (wasReconciling && !sameActivation(previous, this.activation))
        this.activationGeneration += 1;
      this.reservations.clear();
      this.requests.clear();
      this.reconciling = false;
      this.recoveryCommitId = null;
      this.finishCommit();
      return true;
    } catch {
      return false;
    } finally {
      if (this.recoveryGeneration === generation) this.recoveryGeneration += 1;
    }
  }

  maintain(operation: () => Promise<ProfileStateCommitResult>, deadlineMs: number): Promise<void> {
    const maintenance = this.tail.then(async () => {
      const version = this.stateVersion;
      try {
        if (!this.ready || Date.now() >= deadlineMs) return;
        const result = await withinProfileDeadline(operation(), deadlineMs);
        if (
          this.stateVersion !== version ||
          result.state !== "committed" ||
          !result.initialized ||
          !result.profileState ||
          result.storeRevision < this.storeRevision ||
          result.invalidActivation === true ||
          !sameProfiles(result.profileState.profiles, persistentProfiles(this.profiles)) ||
          !sameActivation(result.profileState.activation, this.activation)
        )
          return;
        this.applyCommitted(result);
        this.finishCommit();
      } catch (error) {
        void error;
      }
    });
    this.tail = maintenance;
    return maintenance;
  }

  reconcile(): Promise<boolean> {
    const operation = this.tail.then(() => this.verifyBase());
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  cancelProfileSave(owner: CredentialOwner, reservationId?: string): void {
    for (const [id, entry] of this.reservations) {
      if (
        (reservationId === undefined || reservationId === id) &&
        canonicalJson(entry.reservation.owner) === canonicalJson(owner)
      )
        this.reservations.delete(id);
    }
  }

  deleteProfile(profileId: string, expectedRevision: number): Promise<ProfileMutationResult> {
    return this.enqueueMutation(async () => {
      const target = this.profiles.get(profileId, expectedRevision);
      if (!target) return { outcome: "failed", authority: this.snapshot };
      const nextProfiles = persistentProfiles(this.profiles).filter(
        (profile) => profile.profileId !== profileId,
      );
      const nextActivation = this.activation?.profileId === profileId ? null : this.activation;
      const result = await this.commitState({ profiles: nextProfiles, activation: nextActivation });
      return { outcome: result, authority: this.snapshot };
    });
  }

  private enqueueMutation(
    operation: () => Promise<ProfileMutationResult>,
  ): Promise<ProfileMutationResult> {
    if (this.reconciling || !this.ready)
      return Promise.resolve({ outcome: "pending", authority: this.snapshot });
    const result = this.tail.then(() =>
      this.reconciling || !this.ready
        ? { outcome: "pending" as const, authority: this.snapshot }
        : operation(),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async commitState(profileState: ProfileState): Promise<"changed" | "failed" | "pending"> {
    const confirmedActivation = this.activation ? { ...this.activation } : null;
    const activationChanged = !sameActivation(confirmedActivation, profileState.activation);
    this.beginCommit();
    try {
      const result = await this.commit({
        commitId: this.createCommitId(),
        expectedStoreRevision: this.storeRevision,
        profileState,
      });
      if (result.state === "reconciling" || !this.matchesState(result, profileState)) {
        this.enterReconciliation(confirmedActivation);
        return "pending";
      }
      this.applyCommitted(result);
      if (activationChanged) this.activationGeneration += 1;
      this.finishCommit();
      return "changed";
    } catch {
      this.failCommit(confirmedActivation);
      return "failed";
    } finally {
      this.committing = false;
    }
  }

  private beginCommit(): void {
    this.committing = true;
    this.ready = false;
    this.stateVersion += 1;
  }

  private enterReconciliation(activation: ActivationReference | null): void {
    this.reconciling = true;
    this.activation = activation;
  }

  private failCommit(activation: ActivationReference | null): void {
    this.activation = activation;
    this.ready = true;
    this.stateVersion += 1;
  }

  private finishCommit(): void {
    this.ready = true;
    this.stateVersion += 1;
  }

  private applyCommitted(result: ProfileStateStoreSnapshot): void {
    this.storeRevision = result.storeRevision;
    this.profiles.hydrate(result.profileState?.profiles ?? []);
    this.activation = result.profileState?.activation
      ? { ...result.profileState.activation }
      : null;
    this.credentialConfigured.clear();
    for (const [profileId, configured] of Object.entries(result.credentialConfigured))
      this.credentialConfigured.set(profileId, configured);
  }

  private async execute(input: ProfileActivationSetInput): Promise<ProfileActivationResult> {
    if (this.reconciling || !this.ready)
      return { requestId: input.requestId, outcome: "pending", authority: this.snapshot };
    if (input.authorityId !== this.authorityId) return safeError(input.requestId, this.snapshot);
    const profile = this.profiles.get(input.profileId, input.profileRevision);
    if (!profile || profile.endpointFingerprint !== input.endpointFingerprint)
      return safeError(input.requestId, this.snapshot);
    let candidate: ActivationReference | null;
    if (input.enabled) {
      candidate = {
        profileId: profile.profileId,
        profileRevision: profile.revision,
        kind: profile.kind,
        endpointFingerprint: profile.endpointFingerprint,
        credentialConfigured: this.credentialConfigured.get(profile.profileId) ?? false,
      };
    } else {
      if (
        !this.activation ||
        this.activation.profileId !== profile.profileId ||
        this.activation.profileRevision !== profile.revision ||
        this.activation.endpointFingerprint !== profile.endpointFingerprint
      )
        return { requestId: input.requestId, outcome: "unchanged", authority: this.snapshot };
      candidate = null;
    }
    if (
      !(this.fallbackEntered && this.activationGeneration === 0) &&
      sameActivation(this.activation, candidate)
    )
      return { requestId: input.requestId, outcome: "unchanged", authority: this.snapshot };
    const confirmedActivation = this.activation ? { ...this.activation } : null;
    this.beginCommit();
    try {
      const result = await this.commit({
        commitId: this.createCommitId(),
        expectedStoreRevision: this.storeRevision,
        profileState: {
          profiles: persistentProfiles(this.profiles),
          activation: candidate,
        },
      });
      if (result.state === "reconciling") {
        this.reconciling = true;
        this.activation = confirmedActivation;
        return { requestId: input.requestId, outcome: "pending", authority: this.snapshot };
      }
      if (
        !this.matchesState(result, {
          profiles: persistentProfiles(this.profiles),
          activation: candidate,
        })
      ) {
        this.reconciling = true;
        this.activation = confirmedActivation;
        return { requestId: input.requestId, outcome: "pending", authority: this.snapshot };
      }
      this.applyCommitted(result);
      this.activationGeneration += 1;
      this.finishCommit();
      return { requestId: input.requestId, outcome: "changed", authority: this.snapshot };
    } catch {
      this.failCommit(confirmedActivation);
      return safeError(input.requestId, this.snapshot);
    } finally {
      this.committing = false;
    }
  }

  private matchesState(result: ProfileStateStoreSnapshot, profileState: ProfileState): boolean {
    return Boolean(
      result.initialized &&
      result.storeRevision === this.storeRevision + 1 &&
      result.profileState &&
      sameActivation(result.profileState.activation, profileState.activation) &&
      sameProfiles(result.profileState.profiles, profileState.profiles),
    );
  }
}
