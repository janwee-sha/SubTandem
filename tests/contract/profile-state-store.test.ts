import { describe, expect, it } from "vitest";
import {
  TransportClient,
  type LocalHttpBridge,
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

class ProfileStateBridge implements LocalHttpBridge {
  readonly requests: Array<{ url: string; body: unknown }> = [];
  response: unknown;

  constructor(response: unknown) {
    this.response = response;
  }

  async post<T>(url: string, _bearerToken: string, body: unknown): Promise<T> {
    this.requests.push({ url, body });
    return structuredClone(this.response) as T;
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
  it("reads a strict non-sensitive projection", async () => {
    const bridge = new ProfileStateBridge(snapshot());
    const client = new TransportClient({ port: 49152, token: "opaque-token" }, bridge);

    await expect(client.profileStateRead()).resolves.toEqual(snapshot());
    expect(bridge.requests).toEqual([
      {
        url: "http://127.0.0.1:49152/v1/profile-state",
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
