import { describe, expect, it } from "vitest";
import { HelperProfileStateStore } from "../../src/credentials/store.js";
import { SubTandemError } from "../../src/domain/errors.js";
import { encryptedSaveFrame, encryptedSaveOwner } from "../helpers/encrypted-profile-fixture.js";
import type { TransportRpcClient } from "../../src/transport/client.js";

const profile = {
  profileId: "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
  revision: 1,
  displayName: "A",
  kind: "openai" as const,
  endpoint: "https://example.test",
  endpointFingerprint: "fingerprint",
  proxyMode: "direct" as const,
  model: "model-a",
};
const snapshot = {
  initialized: true,
  storeRevision: 1,
  lastCommit: null,
  profileState: { profiles: [profile], activation: null },
  credentialConfigured: { [profile.profileId]: false },
};

describe("encrypted Profile store", () => {
  it.each(["synthetic-store-key", ""])(
    "forwards one sealed replacement or clear and clones its non-secret result: %s",
    async (value) => {
      const frame = encryptedSaveFrame({ profiles: [profile], activation: null }, value);
      const calls: unknown[] = [];
      const result = { ...structuredClone(snapshot), state: "committed" as const };
      const store = new HelperProfileStateStore({
        profileStateSave: async (...args: unknown[]) => {
          calls.push(args);
          return result;
        },
      } as unknown as TransportRpcClient);
      const saved = await store.save(encryptedSaveOwner, frame);
      expect(calls).toEqual([[encryptedSaveOwner, frame]]);
      expect(saved).toEqual(result);
      saved.credentialConfigured[profile.profileId] = true;
      expect(result.credentialConfigured[profile.profileId]).toBe(false);
      expect(JSON.stringify(calls)).not.toContain("synthetic-store-key");
      expect(store).not.toHaveProperty("getSecret");
      expect(store).not.toHaveProperty("setSecret");
    },
  );

  it("reads only the configured projection and returns an independent snapshot", async () => {
    const store = new HelperProfileStateStore({
      profileStateRead: async () => snapshot,
    } as unknown as TransportRpcClient);
    const first = await store.read();
    first.credentialConfigured[profile.profileId] = true;
    expect((await store.read()).credentialConfigured[profile.profileId]).toBe(false);
    expect(JSON.stringify(first)).not.toContain("apiKey");
  });

  it("preserves safe helper failures and discards transport details", async () => {
    let error: Error = new SubTandemError("PROFILE_STATE_CONFLICT", "configuration", "NONE");
    const store = new HelperProfileStateStore({
      profileStateSave: async () => {
        throw error;
      },
    } as unknown as TransportRpcClient);
    const frame = encryptedSaveFrame(snapshot.profileState);
    await expect(store.save(encryptedSaveOwner, frame)).rejects.toMatchObject({
      code: "PROFILE_STATE_CONFLICT",
    });
    error = new Error("private transport body");
    await expect(store.save(encryptedSaveOwner, frame)).rejects.toMatchObject({
      code: "CREDENTIAL_STORE_UNAVAILABLE",
    });
    await expect(store.save(encryptedSaveOwner, frame)).rejects.not.toThrow(
      /private transport body/,
    );
  });
});
