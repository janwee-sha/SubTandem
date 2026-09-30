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
import { existsSync } from "node:fs";
import { nativeGlobalLifecycle, nativeLifecycleExecutable } from "../helpers/native-global-lifecycle.js";
import { ProviderSimulator } from "../helpers/provider-server.js";
import { PlaybackController } from "../../src/app/controller.js";

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

describe.skipIf(process.platform !== "darwin" || !existsSync(nativeLifecycleExecutable))("Global lifecycle with the built native helper and local provider", () => {
  it.for(["openai", "claude", "deepseek", "ollama"] as const)("atomically saves, uses, replaces, clears and reloads %s without JS credentials", { timeout: 30_000 }, async (kind, { skip }) => {
    const server = new ProviderSimulator();
    await server.start();
    const h = await nativeGlobalLifecycle().catch(async (error) => { await server.close(); throw error; });
    const firstKey = "synthetic-native-lifecycle-first-key";
    const nextKey = "synthetic-native-lifecycle-next-key";
    const candidate = { displayName: "Native lifecycle", kind, endpoint: `${server.url}/${kind}${kind === "openai" || kind === "deepseek" ? "/v1" : ""}`, model: "model-a", proxyMode: "direct" as const };
    const connection = { kind, endpoint: candidate.endpoint, model: candidate.model, proxyMode: candidate.proxyMode };
    server.respondWith((call) => {
      if (call.path.endsWith("/api/version")) return { status: 200, body: { version: "synthetic" } };
      if (call.path.endsWith("/api/tags")) return { status: 200, body: { models: [{ model: "model-a" }] } };
      const body = JSON.parse(call.body);
      const prompt = body.messages.map((message: any) => String(message.content)).join("\n");
      const id = /"id"\s*:\s*"probe"/.test(prompt) ? "probe" : "c1";
      const content = JSON.stringify({ translations: [{ id, text: "hola" }] });
      return { status: 200, body: kind === "claude" ? { type: "message", role: "assistant", content: [{ type: "text", text: content }], stop_reason: "end_turn" } : kind === "ollama" ? { message: { content }, done: true } : { choices: [{ message: { content }, finish_reason: "stop" }] } };
    });
    const header = () => server.calls.at(-1)!.headers[kind === "claude" ? "x-api-key" : "authorization"];
    try {
      expect((await h.global.authority()).profiles).toEqual([]);
      const created = (await h.global.save(candidate, firstKey).catch((error: unknown) => {
        if (h.rpc.some((entry) => (entry.result as { error?: string })?.error === "credential-hardware-unavailable")) {
          expect(h.snapshot().credentials).toEqual({});
          skip("Secure Enclave is unavailable; nonempty native lifecycle is not verified in this environment");
        }
        throw error;
      })).profile;
      expect(created).toMatchObject({ revision: 1, credentialConfigured: true });
      const test = await h.global.send("provider:test", { ...connection, sourceProfile: { profileId: created.profileId, profileRevision: created.revision, endpointFingerprint: created.endpointFingerprint }, drawerId: "saved-test", draftRevision: 1, credential: { source: "saved" } });
      expect(test?.data).toMatchObject({ ok: true });
      expect(header()).toBe(kind === "claude" ? firstKey : `Bearer ${firstKey}`);
      const enable = async (profile: any) => {
        const authority = await h.global.authority();
        const result = await h.global.send("profile-activation:set", { authorityId: authority.authorityId, profileId: profile.profileId, profileRevision: profile.revision, endpointFingerprint: profile.endpointFingerprint, enabled: true });
        expect(result?.data.outcome).toBe("changed");
        return (await h.global.authority());
      };
      const attempt = (profile: any, authority: any, requestId: string) => h.global.send("provider:attempt", {
        playerId: "native-lifecycle-window", requestId, batchId: `batch.${requestId}`, sessionId: "native-lifecycle-session", sessionEpoch: 1, windowEpoch: 1,
        authorityId: authority.authorityId, activationGeneration: authority.activationGeneration, profileId: profile.profileId, profileRevision: profile.revision, endpointFingerprint: profile.endpointFingerprint,
        targetLanguage: "zh-Hans", items: [{ id: "probe", text: "hello" }],
      }, requestId);
      const selected = await enable(created);
      expect((await attempt(created, selected, "translation.first"))?.name).toBe("provider:attempt-result");
      const replaced = (await h.global.save({ ...candidate, profileId: created.profileId, expectedRevision: 1 }, nextKey)).profile;
      expect(replaced).toMatchObject({ revision: 2, credentialConfigured: true });
      expect((await h.global.authority()).activation).toBeNull();
      const before = server.requestCount;
      expect((await attempt(created, selected, "translation.stale"))?.name).toBe("provider:attempt-error");
      expect(server.requestCount).toBe(before);
      await h.global.send("provider:test", { ...connection, sourceProfile: { profileId: replaced.profileId, profileRevision: 2, endpointFingerprint: replaced.endpointFingerprint }, drawerId: "saved-replacement", draftRevision: 1, credential: { source: "saved" } });
      expect(header()).toBe(kind === "claude" ? nextKey : `Bearer ${nextKey}`);
      const cleared = (await h.global.save({ ...candidate, profileId: created.profileId, expectedRevision: 2 }, "")).profile;
      expect(cleared).toMatchObject({ revision: 3, credentialConfigured: false });
      await h.restart();
      expect((await h.global.profiles())).toMatchObject([{ profileId: created.profileId, revision: 3, credentialConfigured: false }]);
      expect((await h.global.authority()).activation).toBeNull();
      const reselected = await enable(cleared);
      expect((await attempt(cleared, reselected, "translation.empty"))?.name).toBe("provider:attempt-result");
      expect(header()).toBeUndefined();
      let visible: readonly string[] = [];
      const controller = new PlaybackController({ playerId: "native-lifecycle-controller", provider: await h.global.createProvider("native-lifecycle-controller"), overlay: { show: (lines) => { visible = lines; }, clear: () => { visible = []; } }, targetLanguage: "zh-Hans", requiresProviderSelection: true });
      controller.setProviderSelection({ ...cleared, authorityId: reselected.authorityId, activationGeneration: reselected.activationGeneration });
      controller.setSource({ format: "srt", contentHash: "native-lifecycle-source", cues: [{ id: "probe", index: 0, startMs: 0, endMs: 1000, sourceText: "hello", normalizedText: "hello" }] });
      controller.setEnabled(false);
      const disabledCount = server.requestCount;
      controller.tick(0);
      await controller.whenIdle();
      expect(server.requestCount).toBe(disabledCount);
      controller.setEnabled(true);
      controller.tick(0);
      await controller.whenIdle();
      expect(visible).toEqual(["hola"]);
      expect(server.requestCount).toBeGreaterThan(disabledCount);
      controller.setEnabled(false);
      expect(visible).toEqual([]);
      expect((await h.global.authority()).activation.profileId).toBe(cleared.profileId);
      await h.global.send("profile:delete", { profileId: created.profileId, expectedRevision: 3, displayName: candidate.displayName });
      expect(await h.global.profiles()).toEqual([]);
      expect(h.snapshot().credentials).toEqual({});
      expect(JSON.stringify(h.rpc)).not.toMatch(/synthetic-native-lifecycle-(first|next)-key|"apiKey"/);
      expect(JSON.stringify(h.global.replies)).not.toMatch(/synthetic-native-lifecycle-(first|next)-key|"apiKey"/);
    } finally { await h.close(); await server.close(); }
  });
});
