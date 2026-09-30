import { profileSaveRequestDigest } from "../../src/transport/client.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProfileActivationAuthority,
  type ProfileSaveReservation,
} from "../../src/providers/profile-activation.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type { ProfileState } from "../../src/domain/types.js";
import type { ProfileStateCommitResult } from "../../src/transport/client.js";
import { encryptedSaveFrame, encryptedSaveOwner } from "../helpers/encrypted-profile-fixture.js";

const input = {
  displayName: "Synthetic",
  kind: "openai" as const,
  endpoint: "https://example.test/v1",
  model: "model-a",
  proxyMode: "direct" as const,
};

function setup(recover?: (commitId: string) => Promise<ProfileStateCommitResult>) {
  let id = 0;
  let revision = 1;
  let state: ProfileState = { profiles: [], activation: null };
  let configured: Record<string, boolean> = {};
  const profiles = new ProviderProfiles(
    () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  );
  const calls: unknown[] = [];
  function receipt(
    commitId: string,
    operation: "commit" | "save-profile",
  ): ProfileStateCommitResult {
    return {
      state: "committed",
      initialized: true,
      storeRevision: ++revision,
      profileState: structuredClone(state),
      credentialConfigured: { ...configured },
      lastCommit: {
        commitId,
        operation,
        baseRevision: revision - 1,
        requestDigest: "0".repeat(64),
      },
    };
  }
  const authority = new ProfileActivationAuthority({
    recover,
    authorityId: "synthetic-authority",
    profiles,
    storeRevision: revision,
    activation: null,
    credentialConfigured: {},
    createCommitId: () => `10000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    commit: async (request) => {
      calls.push(request);
      expect(request.expectedStoreRevision).toBe(revision);
      state = structuredClone(request.profileState);
      configured = Object.fromEntries(
        state.profiles.map((profile) => [
          profile.profileId,
          configured[profile.profileId] ?? false,
        ]),
      );
      return receipt(request.commitId, "commit");
    },
  });
  async function finish(reservation: ProfileSaveReservation, present: boolean) {
    const frame = encryptedSaveFrame(
      reservation.profileState,
      present ? "synthetic-lifecycle-key" : "",
      reservation.expectedStoreRevision,
      reservation.commitId,
      { requestId: reservation.requestId, expiresAtMs: reservation.expiresAtMs },
    );
    return authority.completeProfileSave(
      reservation.reservationId,
      encryptedSaveOwner,
      frame,
      async (owner, submitted) => {
        calls.push({ owner, frame: submitted });
        expect(owner).toEqual(encryptedSaveOwner);
        expect(submitted).toEqual(frame);
        expect(reservation.expectedStoreRevision).toBe(revision);
        state = structuredClone(reservation.profileState);
        configured[reservation.profile.profileId] = present;
        const result = receipt(reservation.commitId, "save-profile");
        result.lastCommit!.requestDigest = profileSaveRequestDigest(owner, submitted);
        return result;
      },
    );
  }
  return { authority, profiles, calls, finish };
}

afterEach(() => vi.useRealTimers());

describe("encrypted Profile authority lifecycle", () => {
  it("reserves the full candidate before sealing and atomically creates, replaces, clears and deletes", async () => {
    const h = setup();
    const first = await h.authority.reserveProfileSave(input, encryptedSaveOwner, "save-1");
    expect(first).toMatchObject({
      expectedStoreRevision: 1,
      expectedProfileRevision: null,
      profile: { revision: 1, model: "model-a", proxyMode: "direct" },
    });
    expect(h.authority.snapshot.profiles).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(await h.finish(first, true)).toMatchObject({ outcome: "changed" });
    expect(h.authority.snapshot.profiles[0]).toMatchObject({
      revision: 1,
      credentialConfigured: true,
    });
    const next = await h.authority.reserveProfileSave(
      { ...input, profileId: first.profile.profileId, expectedRevision: 1, model: "model-b" },
      encryptedSaveOwner,
      "save-2",
    );
    expect(await h.finish(next, true)).toMatchObject({ outcome: "changed" });
    const clear = await h.authority.reserveProfileSave(
      { ...input, profileId: first.profile.profileId, expectedRevision: 2 },
      encryptedSaveOwner,
      "save-3",
    );
    expect(await h.finish(clear, false)).toMatchObject({ outcome: "changed" });
    expect(h.authority.snapshot.profiles[0]).toMatchObject({
      revision: 3,
      credentialConfigured: false,
    });
    expect(await h.authority.deleteProfile(first.profile.profileId, 3)).toMatchObject({
      outcome: "changed",
      authority: { profiles: [] },
    });
    expect(JSON.stringify(h.calls)).not.toContain("synthetic-lifecycle-key");
    expect(JSON.stringify(h.authority.snapshot)).not.toMatch(/apiKey|synthetic-lifecycle-key/);
  });

  it("invalidates an enabled revision only when its atomic save is confirmed", async () => {
    const h = setup();
    const first = await h.authority.reserveProfileSave(input, encryptedSaveOwner, "save-1");
    await h.finish(first, true);
    await h.authority.set({
      senderId: encryptedSaveOwner.senderId,
      requestId: "enable",
      authorityId: "synthetic-authority",
      profileId: first.profile.profileId,
      profileRevision: 1,
      endpointFingerprint: first.profile.endpointFingerprint,
      enabled: true,
    });
    expect(h.authority.acceptsTranslations).toBe(true);
    const edit = await h.authority.reserveProfileSave(
      { ...input, profileId: first.profile.profileId, expectedRevision: 1 },
      encryptedSaveOwner,
      "save-edit",
    );
    expect(h.authority.snapshot.activation?.profileRevision).toBe(1);
    expect(edit.profileState.activation).toBeNull();
    await h.finish(edit, false);
    expect(h.authority.snapshot.activation).toBeNull();
    expect(h.authority.acceptsTranslations).toBe(false);
  });

  it("rejects cancelled, expired or foreign-owner reservations without persistence", async () => {
    vi.useFakeTimers();
    const h = setup();
    const first = await h.authority.reserveProfileSave(input, encryptedSaveOwner, "save-1");
    const frame = encryptedSaveFrame(
      first.profileState,
      "",
      first.expectedStoreRevision,
      first.commitId,
      { requestId: first.requestId, expiresAtMs: first.expiresAtMs },
    );
    const save = vi.fn();
    expect(
      await h.authority.completeProfileSave(
        first.reservationId,
        { ...encryptedSaveOwner, senderId: "other-window" },
        frame,
        save,
      ),
    ).toMatchObject({ outcome: "failed" });
    h.authority.cancelProfileSave(encryptedSaveOwner, first.reservationId);
    expect(
      await h.authority.completeProfileSave(first.reservationId, encryptedSaveOwner, frame, save),
    ).toMatchObject({ outcome: "failed" });
    const second = await h.authority.reserveProfileSave(input, encryptedSaveOwner, "save-2");
    vi.setSystemTime(second.expiresAtMs + 1);
    const secondFrame = encryptedSaveFrame(
      second.profileState,
      "",
      second.expectedStoreRevision,
      second.commitId,
      { requestId: second.requestId, expiresAtMs: second.expiresAtMs },
    );
    expect(
      await h.authority.completeProfileSave(
        second.reservationId,
        encryptedSaveOwner,
        secondFrame,
        save,
      ),
    ).toMatchObject({ outcome: "failed" });
    expect(save).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("blocks uncertain saves until a durable current snapshot fences delayed commits", async () => {
    const recovered: ProfileStateCommitResult = {
      state: "reconciling",
      initialized: true,
      storeRevision: 3,
      lastCommit: null,
      profileState: null,
      credentialConfigured: {},
    };
    const recover = vi.fn(async (commitId: string) => ({
      ...recovered,
      lastCommit: {
        commitId,
        operation: "open" as const,
        baseRevision: 2,
        requestDigest: "a".repeat(64),
      },
    }));
    const h = setup(recover);
    const reservation = await h.authority.reserveProfileSave(
      input,
      encryptedSaveOwner,
      "save-uncertain",
    );
    const frame = encryptedSaveFrame(
      reservation.profileState,
      "",
      reservation.expectedStoreRevision,
      reservation.commitId,
      { requestId: reservation.requestId, expiresAtMs: reservation.expiresAtMs },
    );
    const save = vi.fn(async () => {
      throw new Error("response lost");
    });
    expect(
      await h.authority.completeProfileSave(
        reservation.reservationId,
        encryptedSaveOwner,
        frame,
        save,
      ),
    ).toMatchObject({ outcome: "pending", authority: { ready: false } });
    await expect(
      h.authority.reserveProfileSave(input, encryptedSaveOwner, "blocked"),
    ).rejects.toThrow();
    Object.assign(recovered, {
      state: "reconciling",
      initialized: true,
      storeRevision: 3,
      lastCommit: null,
      profileState: reservation.profileState,
      credentialConfigured: { [reservation.profile.profileId]: false },
    });
    expect(await h.authority.reconcile()).toBe(false);
    expect(h.authority.snapshot.ready).toBe(false);
    recovered.state = "committed";
    expect(await h.authority.reconcile()).toBe(true);
    expect(h.authority.snapshot).toMatchObject({
      ready: true,
      profiles: [{ revision: 1, credentialConfigured: false }],
    });
    expect(h.authority.acceptsTranslations).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await h.authority.reconcile()).toBe(false);
    expect(recover).toHaveBeenCalledTimes(2);
    await expect(
      h.authority.reserveProfileSave(input, encryptedSaveOwner, "new-save"),
    ).resolves.toMatchObject({ expectedStoreRevision: 3 });
  });

  it("rejects a frame whose frozen candidate changed after reservation", async () => {
    const h = setup();
    const reservation = await h.authority.reserveProfileSave(input, encryptedSaveOwner, "save-1");
    const changed = structuredClone(reservation.profileState);
    changed.profiles[0]!.model = "different-model";
    const frame = encryptedSaveFrame(
      changed,
      "",
      reservation.expectedStoreRevision,
      reservation.commitId,
      { requestId: reservation.requestId, expiresAtMs: reservation.expiresAtMs },
    );
    const save = vi.fn();
    expect(
      await h.authority.completeProfileSave(
        reservation.reservationId,
        encryptedSaveOwner,
        frame,
        save,
      ),
    ).toMatchObject({ outcome: "failed" });
    expect(save).not.toHaveBeenCalled();
  });
});
