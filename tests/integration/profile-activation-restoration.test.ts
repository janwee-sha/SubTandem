import { describe, expect, it } from "vitest";
import type { ActivationReference, ProfileState } from "../../src/domain/types.js";
import {
  restoreProfileActivationAuthority,
  type ProfileActivationStore,
} from "../../src/providers/profile-activation.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type {
  ProfileStateCommitResult,
  ProfileStateStoreSnapshot,
} from "../../src/transport/client.js";
import { ProfileActivationSync } from "../../src/adapters/iina/profile-activation-sync.js";
import { identityHash } from "../../src/domain/identity.js";

const profile = {
  profileId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  revision: 3,
  displayName: "A",
  kind: "openai" as const,
  endpoint: "https://a.example/v1",
  endpointFingerprint: identityHash({
    kind: "openai",
    endpoint: "https://a.example/v1",
    proxyMode: "direct",
  }),
  proxyMode: "direct" as const,
  model: "model-a",
};

function activation(credentialConfigured = true): ActivationReference {
  return {
    profileId: profile.profileId,
    profileRevision: profile.revision,
    kind: profile.kind,
    endpointFingerprint: profile.endpointFingerprint,
    credentialConfigured,
  };
}

class RestorationStore implements ProfileActivationStore {
  readonly calls: string[] = [];
  revision: number;
  initialized: boolean;
  state: ProfileState | null;
  configured: Record<string, boolean>;
  invalidActivation = false;
  unavailable = false;

  constructor(
    input: {
      revision?: number;
      initialized?: boolean;
      state?: ProfileState | null;
      configured?: Record<string, boolean>;
    } = {},
  ) {
    this.revision = input.revision ?? 0;
    this.initialized = input.initialized ?? false;
    this.state = structuredClone(input.state ?? null);
    this.configured = { ...(input.configured ?? {}) };
  }

  async read(): Promise<ProfileStateStoreSnapshot> {
    this.calls.push("read");
    if (this.unavailable) throw new Error("private disk detail");
    return this.snapshot();
  }

  async open(): Promise<ProfileStateCommitResult> {
    this.calls.push("open");
    this.revision += 1;
    return { state: "committed", ...this.snapshot() };
  }

  async initialize(
    _commitId: string,
    expectedStoreRevision: number,
    profiles: ProfileState["profiles"],
  ): Promise<ProfileStateCommitResult> {
    this.calls.push("initialize");
    if (this.initialized || expectedStoreRevision !== this.revision) throw new Error("conflict");
    this.initialized = true;
    this.revision += 1;
    this.state = { profiles: structuredClone(profiles), activation: null };
    this.configured = Object.fromEntries(profiles.map((value) => [value.profileId, false]));
    return { state: "committed", ...this.snapshot() };
  }

  async commit(
    _commitId: string,
    expectedStoreRevision: number,
    profileState: ProfileState,
  ): Promise<ProfileStateCommitResult> {
    this.calls.push("commit");
    if (expectedStoreRevision !== this.revision) throw new Error("conflict");
    this.revision += 1;
    this.state = structuredClone(profileState);
    this.invalidActivation = false;
    return { state: "committed", ...this.snapshot() };
  }

  lateCommit(expectedStoreRevision: number): void {
    if (expectedStoreRevision !== this.revision) throw new Error("PROFILE_STATE_CONFLICT");
  }

  private snapshot(): ProfileStateStoreSnapshot {
    return {
      initialized: this.initialized,
      storeRevision: this.revision,
      lastCommit: null,
      profileState: structuredClone(this.state),
      credentialConfigured: { ...this.configured },
      ...(this.invalidActivation ? { invalidActivation: true as const } : {}),
    };
  }
}

function profiles(): ProviderProfiles {
  return new ProviderProfiles(() => "00000000-0000-4000-8000-000000000099");
}

describe("Profile activation restoration", () => {
  it("restores four persisted Profiles and their activation on cold start", async () => {
    const restoredProfiles = [0, 1, 2, 3].map((index) => ({
      ...profile,
      profileId: `7a90a4e6-cc4f-4f59-99b7-8ff522f887a${index}`,
      displayName: `Profile ${index + 1}`,
      endpoint: `https://profile-${index + 1}.example/v1`,
      endpointFingerprint: identityHash({
        kind: "openai",
        endpoint: `https://profile-${index + 1}.example/v1`,
        proxyMode: "direct",
      }),
    }));
    const active = restoredProfiles[2]!;
    const store = new RestorationStore({
      revision: 215,
      initialized: true,
      state: {
        profiles: restoredProfiles,
        activation: {
          profileId: active.profileId,
          profileRevision: active.revision,
          kind: active.kind,
          endpointFingerprint: active.endpointFingerprint,
          credentialConfigured: true,
        },
      },
      configured: Object.fromEntries(restoredProfiles.map((value) => [value.profileId, true])),
    });

    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-cold-start",
      profiles: profiles(),
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000008",
    });

    expect(authority.snapshot).toMatchObject({
      ready: true,
      activation: { profileId: active.profileId },
    });
    expect(authority.snapshot.profiles).toHaveLength(4);
    expect(authority.snapshot.profiles.map((value) => value.displayName)).toEqual([
      "Profile 1",
      "Profile 2",
      "Profile 3",
      "Profile 4",
    ]);
  });

  it("preserves the persisted Profile order across restoration and window projections", async () => {
    const second = {
      ...profile,
      profileId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887af",
      displayName: "B",
      endpoint: "https://b.example/v1",
      endpointFingerprint: identityHash({
        kind: "openai",
        endpoint: "https://b.example/v1",
        proxyMode: "direct",
      }),
    };
    const store = new RestorationStore({
      revision: 3,
      initialized: true,
      state: { profiles: [second, profile], activation: null },
      configured: { [second.profileId]: false, [profile.profileId]: false },
    });
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-order",
      profiles: profiles(),
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000009",
    });

    expect(authority.snapshot.profiles.map((value) => value.profileId)).toEqual([
      second.profileId,
      profile.profileId,
    ]);
    const first = new ProfileActivationSync("get-first");
    const secondWindow = new ProfileActivationSync("get-second");
    expect(first.accept(authority.snapshot, "get-first")).toBe(true);
    expect(secondWindow.accept(authority.snapshot, "get-second")).toBe(true);
    expect(first.snapshot.profiles).toEqual(secondWindow.snapshot.profiles);
  });

  it("imports latest Profiles once as disabled without changing their revisions", async () => {
    const registry = profiles();
    const store = new RestorationStore();
    let legacyReads = 0;
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-import",
      profiles: registry,
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000010",
      loadLegacyProfiles: () => {
        legacyReads += 1;
        return [profile];
      },
    });

    expect(store.calls).toEqual(["read", "initialize"]);
    expect(authority.snapshot).toMatchObject({ ready: true, activation: null });
    expect(authority.snapshot.profiles[0]?.revision).toBe(3);
    expect(legacyReads).toBe(1);
  });

  it("opens one startup barrier and gives simultaneous windows the same restored activation", async () => {
    const store = new RestorationStore({
      revision: 7,
      initialized: true,
      state: { profiles: [profile], activation: activation() },
      configured: { [profile.profileId]: true },
    });
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-restored",
      profiles: profiles(),
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000011",
      loadLegacyProfiles: () => {
        throw new Error("legacy storage must not be read");
      },
    });
    const first = new ProfileActivationSync("get-a");
    const second = new ProfileActivationSync("get-b");

    expect(first.accept(authority.snapshot, "get-a")).toBe(true);
    expect(second.accept(authority.snapshot, "get-b")).toBe(true);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(authority.snapshot.profiles[0]?.revision).toBe(3);
    expect(store.calls).toEqual(["read", "open"]);
    expect(() => store.lateCommit(7)).toThrow("PROFILE_STATE_CONFLICT");
  });

  it("atomically clears an invalid activation projection before becoming ready", async () => {
    const store = new RestorationStore({
      revision: 4,
      initialized: true,
      state: { profiles: [profile], activation: null },
      configured: { [profile.profileId]: false },
    });
    store.invalidActivation = true;
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-invalid",
      profiles: profiles(),
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000012",
    });

    expect(store.calls).toEqual(["read", "open", "commit"]);
    expect(authority.snapshot).toMatchObject({ ready: true, activation: null });
  });

  it("stays not ready and does not initialize from legacy data when storage is unreadable", async () => {
    const registry = profiles();
    registry.hydrate([profile]);
    const store = new RestorationStore();
    store.unavailable = true;
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-unavailable",
      profiles: registry,
      store,
      createCommitId: () => "00000000-0000-4000-8000-000000000013",
    });

    expect(store.calls).toEqual(["read"]);
    expect(authority.snapshot).toMatchObject({ ready: false, activation: null, profiles: [] });
    expect(authority.acceptsTranslations).toBe(false);
  });
});
