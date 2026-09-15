import { describe, expect, it } from "vitest";
import {
  CredentialStoreError,
  HelperCredentialStore,
  HelperProfileStateStore,
} from "../../src/credentials/store.js";
import { SubTandemError } from "../../src/domain/errors.js";
import type { ProfileState } from "../../src/domain/types.js";
import type {
  ProfileStateCommitResult,
  ProfileStateStoreSnapshot,
  TransportRpcClient,
} from "../../src/transport/client.js";

const profileId = "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae";
const profile = {
  profileId: profileId as ProfileState["profiles"][number]["profileId"],
  revision: 1,
  displayName: "A",
  kind: "openai" as const,
  endpoint: "https://example.test/v1",
  endpointFingerprint: "fingerprint" as ProfileState["profiles"][number]["endpointFingerprint"],
  proxyMode: "direct" as const,
  model: "model-a",
};

class MemoryStateTransport {
  readonly values = new Map<string, Record<string, string>>();
  fail = false;
  helperUnavailable = false;
  snapshot: ProfileStateStoreSnapshot = {
    initialized: true,
    storeRevision: 1,
    lastCommit: null,
    profileState: { profiles: [profile], activation: null },
    credentialConfigured: { [profileId]: false },
  };

  private assertAvailable(): void {
    if (this.helperUnavailable)
      throw new SubTandemError("HELPER_UNAVAILABLE", "network", "RESTART_IINA", true);
    if (this.fail) throw new Error("private transport detail");
  }

  async credentialRead(id: string): Promise<Record<string, string> | null> {
    this.assertAvailable();
    const fields = this.values.get(id);
    return fields ? { ...fields } : null;
  }

  async credentialWrite(
    id: string,
    fields: Record<string, string>,
    commitId: string,
    expectedStoreRevision: number,
    expectedProfileRevision: number,
  ): Promise<ProfileStateCommitResult> {
    this.assertAvailable();
    if (expectedStoreRevision !== this.snapshot.storeRevision || expectedProfileRevision !== 1)
      throw new SubTandemError("PROFILE_STATE_CONFLICT", "configuration", "NONE");
    this.values.set(id, { ...fields });
    this.snapshot = {
      ...this.snapshot,
      storeRevision: this.snapshot.storeRevision + 1,
      lastCommit: {
        commitId,
        operation: "credential-write",
        baseRevision: expectedStoreRevision,
        requestDigest: "safe",
      },
      credentialConfigured: { [profileId]: true },
    };
    return { state: "committed", ...structuredClone(this.snapshot) };
  }

  async profileStateRead(): Promise<ProfileStateStoreSnapshot> {
    this.assertAvailable();
    return structuredClone(this.snapshot);
  }
}

function credentialOptions(storeRevision = 1) {
  return {
    commitId: "00000000-0000-4000-8000-000000000001",
    expectedStoreRevision: storeRevision,
    expectedProfileRevision: 1,
  };
}

describe("plugin-private Profile and credential stores", () => {
  it("writes one secret through a versioned commit and returns only configured state", async () => {
    const transport = new MemoryStateTransport();
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);
    const result = await store.setSecret(profileId, { apiKey: "private-key" }, credentialOptions());

    expect(result).toMatchObject({ state: "committed", storeRevision: 2 });
    expect(result.credentialConfigured).toEqual({ [profileId]: true });
    expect(JSON.stringify(result)).not.toMatch(/private-key|apiKey/);
    await expect(store.getSecret(profileId)).resolves.toEqual({ apiKey: "private-key" });
  });

  it("does not expose an independent credential delete path", () => {
    const store = new HelperCredentialStore(
      new MemoryStateTransport() as unknown as TransportRpcClient,
    );
    expect(store).not.toHaveProperty("deleteSecret");
  });

  it("exposes Profile state with only a credentialConfigured projection", async () => {
    const transport = new MemoryStateTransport();
    transport.values.set(profileId, { apiKey: "private-key" });
    transport.snapshot.credentialConfigured[profileId] = true;
    const store = new HelperProfileStateStore(transport as unknown as TransportRpcClient);

    const result = await store.read();
    expect(result.credentialConfigured).toEqual({ [profileId]: true });
    expect(JSON.stringify(result)).not.toMatch(/apiKey|private-key/);
  });

  it("returns cloned state and secret values", async () => {
    const transport = new MemoryStateTransport();
    const credentialStore = new HelperCredentialStore(transport as unknown as TransportRpcClient);
    await credentialStore.setSecret(profileId, { apiKey: "private-key" }, credentialOptions());
    const loaded = await credentialStore.getSecret(profileId);
    loaded!.apiKey = "mutated";
    await expect(credentialStore.getSecret(profileId)).resolves.toEqual({ apiKey: "private-key" });

    const stateStore = new HelperProfileStateStore(transport as unknown as TransportRpcClient);
    const first = await stateStore.read();
    first.credentialConfigured[profileId] = false;
    await expect(stateStore.read()).resolves.toMatchObject({
      credentialConfigured: { [profileId]: true },
    });
  });

  it("rejects unsupported fields, empty values and invalid profile IDs before persistence", async () => {
    const store = new HelperCredentialStore(
      new MemoryStateTransport() as unknown as TransportRpcClient,
    );
    await expect(
      store.setSecret("not-a-uuid", { apiKey: "private-key" }, credentialOptions()),
    ).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(
      store.setSecret(profileId, { apiKey: "" }, credentialOptions()),
    ).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(
      store.setSecret(profileId, { password: "private" }, credentialOptions()),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("preserves safe helper errors and hides other transport details", async () => {
    const transport = new MemoryStateTransport();
    const store = new HelperCredentialStore(transport as unknown as TransportRpcClient);
    transport.helperUnavailable = true;
    await expect(store.getSecret(profileId)).rejects.toMatchObject({
      code: "HELPER_UNAVAILABLE",
      userAction: "RESTART_IINA",
    });
    transport.helperUnavailable = false;
    transport.fail = true;
    await expect(
      store.setSecret(profileId, { apiKey: "private-key" }, credentialOptions()),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
    await expect(
      store.setSecret(profileId, { apiKey: "private-key" }, credentialOptions()),
    ).rejects.not.toThrow(/private transport detail|private-key/);
  });
});
