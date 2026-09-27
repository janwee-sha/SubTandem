import { describe, expect, it } from "vitest";
import {
  ProfileActivationAuthority,
  restoreProfileActivationAuthority,
} from "../../src/providers/profile-activation.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import {
  TransportClient,
  parseProfileStateStoreSnapshot,
  type LocalRpcBridge,
  type ProfileStateStoreSnapshot,
} from "../../src/transport/client.js";

const profile = {
  profileId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  revision: 3,
  displayName: "A",
  kind: "openai" as const,
  endpoint: "https://example.test/v1",
  endpointFingerprint: "fingerprint-a",
  proxyMode: "direct" as const,
  model: "model-a",
};

class ProfileStateBridge implements LocalRpcBridge {
  readonly requests: Array<{ port: number; path: string; body: unknown }> = [];
  response: unknown;

  constructor(response: unknown) {
    this.response = response;
  }

  async post<T>(port: number, _bearerToken: string, path: string, body: unknown): Promise<T> {
    this.requests.push({ port, path, body });
    return structuredClone(this.response) as T;
  }
}

function sortedKeysClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => sortedKeysClone(entry)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortedKeysClone(entry)]),
  ) as T;
}

class NativeSortedProfileStateBridge implements LocalRpcBridge {
  async post<T>(_port: number, _bearerToken: string, _path: string, body: unknown): Promise<T> {
    const request = body as {
      action: string;
      commitId: string;
      expectedStoreRevision: number;
      profileState: NonNullable<ProfileStateStoreSnapshot["profileState"]>;
    };
    if (request.action !== "commit") throw new Error("UNEXPECTED_PROFILE_STATE_ACTION");
    return sortedKeysClone({
      state: "committed",
      initialized: true,
      storeRevision: request.expectedStoreRevision + 1,
      lastCommit: {
        commitId: request.commitId,
        operation: "commit",
        baseRevision: request.expectedStoreRevision,
        requestDigest: "safe",
      },
      profileState: request.profileState,
      credentialConfigured: Object.fromEntries(
        request.profileState.profiles.map((entry) => [entry.profileId, false]),
      ),
    }) as T;
  }
}

function snapshot(): ProfileStateStoreSnapshot {
  return {
    initialized: true,
    storeRevision: 7,
    lastCommit: null,
    profileState: { profiles: [profile], activation: null },
    credentialConfigured: { [profile.profileId]: true },
  };
}

describe("versioned Profile state transport", () => {
  it("keeps a missing disabled activation as a strict protocol failure and blocks restoration saves", async () => {
    const swiftCodableOmission = {
      ...snapshot(),
      profileState: { profiles: [profile] },
    };
    expect(() => parseProfileStateStoreSnapshot(swiftCodableOmission)).toThrow();

    const bridge = new ProfileStateBridge(swiftCodableOmission);
    const client = new TransportClient({ port: 49152, token: "opaque-token" }, bridge);
    const profiles = new ProviderProfiles(() => "8b90a4e6-cc4f-4f59-99b7-8ff522f887ae");
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority-disabled-wire-failure",
      profiles,
      store: {
        read: () => client.profileStateRead(),
        open: (commitId) => client.profileStateOpen(commitId),
        initialize: (commitId, expectedStoreRevision, storedProfiles) =>
          client.profileStateInitialize(commitId, expectedStoreRevision, storedProfiles),
        commit: (commitId, expectedStoreRevision, profileState) =>
          client.profileStateCommit(commitId, expectedStoreRevision, profileState),
      },
      createCommitId: () => "00000000-0000-4000-8000-000000000099",
    });

    expect(authority.snapshot).toMatchObject({ ready: false, profiles: [] });
    await expect(
      authority.saveProfile({
        displayName: "Blocked",
        kind: "ollama",
        endpoint: "http://127.0.0.1:11434",
        proxyMode: "system",
        model: "model-a",
      }),
    ).resolves.toMatchObject({ outcome: "pending", authority: { ready: false } });
  });

  it("creates and updates Profiles through a native sorted-key commit response", async () => {
    const client = new TransportClient(
      { port: 49152, token: "opaque-token" },
      new NativeSortedProfileStateBridge(),
    );
    const profiles = new ProviderProfiles(() => "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae");
    let commitSequence = 0;
    const authority = new ProfileActivationAuthority({
      authorityId: "authority-1",
      profiles,
      storeRevision: 1,
      credentialConfigured: {},
      activation: null,
      commit: ({ commitId, expectedStoreRevision, profileState }) =>
        client.profileStateCommit(commitId, expectedStoreRevision, profileState),
      createCommitId: () => `00000000-0000-4000-8000-${String(++commitSequence).padStart(12, "0")}`,
    });

    const created = await authority.saveProfile({
      displayName: "A",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      proxyMode: "system",
      model: "model-a",
    });
    expect(created).toMatchObject({
      outcome: "changed",
      profile: { revision: 1, displayName: "A" },
      authority: { ready: true },
    });

    const updated = await authority.saveProfile({
      profileId: created.profile!.profileId,
      expectedRevision: created.profile!.revision,
      displayName: "A updated",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      proxyMode: "system",
      model: "model-b",
    });
    expect(updated).toMatchObject({
      outcome: "changed",
      profile: { revision: 2, displayName: "A updated", model: "model-b" },
      authority: { ready: true },
    });
  });

  it("reads a strict non-sensitive projection", async () => {
    const bridge = new ProfileStateBridge(snapshot());
    const client = new TransportClient({ port: 49152, token: "opaque-token" }, bridge);

    await expect(client.profileStateRead()).resolves.toEqual(snapshot());
    expect(bridge.requests).toEqual([
      {
        port: 49152,
        path: "/v1/profile-state",
        body: { action: "read" },
      },
    ]);

    bridge.response = { ...snapshot(), credentials: { [profile.profileId]: { apiKey: "secret" } } };
    await expect(client.profileStateRead()).rejects.toMatchObject({ code: "HELPER_PROTOCOL" });
  });

  it("accepts only a safe invalid-activation projection for credential or revision mismatch", async () => {
    const invalid = {
      ...snapshot(),
      profileState: { profiles: [profile], activation: null },
      credentialConfigured: { [profile.profileId]: false },
      invalidActivation: true as const,
    };
    const bridge = new ProfileStateBridge(invalid);
    const client = new TransportClient({ port: 49152, token: "opaque-token" }, bridge);

    await expect(client.profileStateRead()).resolves.toEqual(invalid);
    for (const leaked of [
      { credentials: { [profile.profileId]: { apiKey: "PRIVATE" } } },
      { apiKey: "PRIVATE" },
      { invalidActivation: false },
    ]) {
      bridge.response = { ...invalid, ...leaked };
      await expect(client.profileStateRead()).rejects.toMatchObject({ code: "HELPER_PROTOCOL" });
    }
  });

  it("sends exact open, initialize and commit CAS requests", async () => {
    const bridge = new ProfileStateBridge({ ...snapshot(), state: "committed" });
    const client = new TransportClient({ port: 49152, token: "opaque-token" }, bridge);

    await client.profileStateOpen("00000000-0000-4000-8000-000000000010");
    await client.profileStateInitialize("00000000-0000-4000-8000-000000000011", 7, [profile]);
    await client.profileStateCommit("00000000-0000-4000-8000-000000000012", 7, {
      profiles: [profile],
      activation: null,
    });

    expect(bridge.requests.map((request) => request.body)).toEqual([
      { action: "open", commitId: "00000000-0000-4000-8000-000000000010" },
      {
        action: "initialize",
        commitId: "00000000-0000-4000-8000-000000000011",
        expectedStoreRevision: 7,
        profiles: [profile],
      },
      {
        action: "commit",
        commitId: "00000000-0000-4000-8000-000000000012",
        expectedStoreRevision: 7,
        profileState: { profiles: [profile], activation: null },
      },
    ]);
  });
});

it.each(["openai", "claude", "deepseek", "ollama"] as const)(
  "preserves %s endpoint spelling and credential reference on the wire",
  async (kind) => {
    const saved = { ...profile, kind, endpoint: "HTTPS://Example.test:443/Root/%41///" };
    const state = { ...snapshot(), profileState: { profiles: [saved], activation: null } };
    const client = new TransportClient(
      { port: 49152, token: "opaque-token" },
      new ProfileStateBridge(state),
    );
    expect(await client.profileStateRead()).toEqual(state);
  },
);
