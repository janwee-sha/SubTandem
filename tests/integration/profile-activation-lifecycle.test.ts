import { describe, expect, it } from "vitest";
import type { TranslationProvider } from "../../src/providers/provider.js";
import { ProviderBroker } from "../../src/providers/broker.js";
import { ProfileActivationAuthority } from "../../src/providers/profile-activation.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type {
  ProviderProfileSnapshot,
  TranslationBatchRequest,
  TranslationBatchResult,
} from "../../src/providers/types.js";
import type { ProfileState } from "../../src/domain/types.js";
import type { ProfileStateCommitResult } from "../../src/transport/client.js";
import { CompletionQueue } from "../helpers/profile-activation-harness.js";

function setup() {
  let id = 0;
  const profiles = new ProviderProfiles(() => `profile-${++id}`);
  const a = profiles.save({
    displayName: "A",
    kind: "openai",
    endpoint: "https://a.example/v1",
    model: "model-a",
  });
  const b = profiles.save({
    displayName: "B",
    kind: "openai",
    endpoint: "https://b.example/v1",
    model: "model-b",
  });
  const c = profiles.save({
    displayName: "C",
    kind: "claude",
    endpoint: "https://c.example/v1",
    model: "model-c",
  });
  const d = profiles.save({
    displayName: "D",
    kind: "ollama",
    endpoint: "http://d.example",
    model: "model-d",
  });
  const commits: ProfileState[] = [];
  const commit = async (input: {
    commitId: string;
    expectedStoreRevision: number;
    profileState: ProfileState;
  }): Promise<ProfileStateCommitResult> => {
    commits.push(structuredClone(input.profileState));
    return {
      state: "committed",
      initialized: true,
      storeRevision: input.expectedStoreRevision + 1,
      lastCommit: {
        commitId: input.commitId,
        operation: "commit",
        baseRevision: input.expectedStoreRevision,
        requestDigest: "safe",
      },
      profileState: structuredClone(input.profileState),
      credentialConfigured: Object.fromEntries(
        input.profileState.profiles.map((profile) => [
          profile.profileId,
          profile.kind === "claude",
        ]),
      ),
    };
  };
  let commitId = 0;
  const authority = new ProfileActivationAuthority({
    authorityId: "authority-1",
    profiles,
    storeRevision: 1,
    credentialConfigured: {
      [a.profileId]: false,
      [b.profileId]: false,
      [c.profileId]: true,
      [d.profileId]: false,
    },
    activation: null,
    commit,
    createCommitId: () => `00000000-0000-4000-8000-${String(++commitId).padStart(12, "0")}`,
  });
  return { profiles, authority, a, b, c, d, commits };
}

function activationRequest(profile: ProviderProfileSnapshot, enabled: boolean, requestId: string) {
  return {
    senderId: "iina-window-1",
    requestId,
    authorityId: "authority-1",
    profileId: profile.profileId,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
    enabled,
  };
}

function providerRequest(
  profile: ProviderProfileSnapshot,
  authorityId: string,
  activationGeneration: number,
): TranslationBatchRequest {
  return {
    playerId: "main-lifecycle-1" as TranslationBatchRequest["playerId"],
    requestId: "request-1" as TranslationBatchRequest["requestId"],
    batchId: "batch-1" as TranslationBatchRequest["batchId"],
    sessionId: "session-1" as TranslationBatchRequest["sessionId"],
    sessionEpoch: 1,
    windowEpoch: 1,
    authorityId,
    activationGeneration,
    profileId: profile.profileId,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
    targetLanguage: "zh-Hans",
    items: [{ id: "cue-1", text: "hello" }],
  };
}

describe("global Profile activation lifecycle", () => {
  it("cancels each obsolete Provider generation once across OpenAI, Claude and Ollama", async () => {
    const { profiles, authority, a, c, d } = setup();
    const controls = new Map<
      string,
      {
        active: number;
        cancelCount: number;
        progress?: (value: TranslationBatchResult) => void;
        resolve?: (value: TranslationBatchResult) => void;
        reject?: (error: unknown) => void;
      }
    >();
    const broker = new ProviderBroker(profiles, authority, (profile) => ({
      attempt: (_request, onProgress) => {
        const pending = new Promise<TranslationBatchResult>((resolve, reject) => {
          controls.set(profile.profileId, {
            active: 1,
            cancelCount: controls.get(profile.profileId)?.cancelCount ?? 0,
            progress: onProgress,
            resolve,
            reject,
          });
        });
        return pending.finally(() => {
          controls.get(profile.profileId)!.active = 0;
        });
      },
      cancel: async () => {
        const control = controls.get(profile.profileId)!;
        control.active = 0;
        control.cancelCount += 1;
        control.reject?.({ category: "cancelled", retryable: false });
      },
    }));
    const activate = async (profile: ProviderProfileSnapshot, requestId: string) => {
      const result = await authority.set(activationRequest(profile, true, requestId));
      if (result.outcome === "changed") await broker.cancelAll();
      return authority.snapshot;
    };

    let snapshot = await activate(a, "activate-openai");
    const progress: string[] = [];
    const openai = broker.attempt(
      "iina-window-1",
      providerRequest(a, snapshot.authorityId, snapshot.activationGeneration),
      (value) => progress.push(value.translations[0]?.text ?? ""),
    );
    while (!controls.has(a.profileId)) await Promise.resolve();
    snapshot = await activate(c, "activate-claude");
    await expect(openai).rejects.toMatchObject({ category: "cancelled" });
    controls.get(a.profileId)?.progress?.({ translations: [{ id: "cue-1", text: "late-a" }] });

    const claude = broker.attempt(
      "iina-window-1",
      providerRequest(c, snapshot.authorityId, snapshot.activationGeneration),
      (value) => progress.push(value.translations[0]?.text ?? ""),
    );
    while (!controls.has(c.profileId)) await Promise.resolve();
    snapshot = await activate(d, "activate-ollama");
    await expect(claude).rejects.toMatchObject({ category: "cancelled" });
    controls.get(c.profileId)?.progress?.({ translations: [{ id: "cue-1", text: "late-b" }] });

    const ollama = broker.attempt(
      "iina-window-1",
      providerRequest(d, snapshot.authorityId, snapshot.activationGeneration),
      (value) => progress.push(value.translations[0]?.text ?? ""),
    );
    while (!controls.has(d.profileId)) await Promise.resolve();
    controls.get(d.profileId)?.progress?.({ translations: [{ id: "cue-1", text: "current" }] });
    controls.get(d.profileId)?.resolve?.({
      translations: [{ id: "cue-1", text: "ollama-final" }],
    });

    await expect(ollama).resolves.toEqual({
      translations: [{ id: "cue-1", text: "ollama-final" }],
    });
    expect(progress).toEqual(["current"]);
    expect(controls.get(a.profileId)).toMatchObject({ active: 0, cancelCount: 1 });
    expect(controls.get(c.profileId)).toMatchObject({ active: 0, cancelCount: 1 });
    expect(controls.get(d.profileId)).toMatchObject({ active: 0, cancelCount: 0 });
    expect([...controls.values()].every(({ active }) => active === 0)).toBe(true);
  });

  it("rejects A after a B switch completes while Provider construction is waiting", async () => {
    const { profiles, authority, a, b } = setup();
    await authority.set(activationRequest(a, true, "activate-a"));
    const builds = new CompletionQueue<ProviderProfileSnapshot, TranslationProvider>();
    const broker = new ProviderBroker(
      profiles,
      authority,
      async (profile) => builds.hold(profile).promise,
    );
    const old = authority.snapshot;
    const attempt = broker.attempt(
      "iina-window-1",
      providerRequest(a, old.authorityId, old.activationGeneration),
    );
    await builds.waitForPending();
    await authority.set(activationRequest(b, true, "activate-b"));
    builds.releaseNext({
      attempt: async (): Promise<TranslationBatchResult> => ({ translations: [] }),
    });

    await expect(attempt).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  });

  it("rejects late progress and final across A to disabled to A generations", async () => {
    const { profiles, authority, a } = setup();
    await authority.set(activationRequest(a, true, "activate-a-1"));
    const final = new CompletionQueue<void, TranslationBatchResult>();
    let publishProgress: ((value: TranslationBatchResult) => void) | undefined;
    const provider: TranslationProvider = {
      attempt: async (_request, onProgress) => {
        publishProgress = onProgress;
        return final.hold().promise;
      },
    };
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const old = authority.snapshot;
    const progress: TranslationBatchResult[] = [];
    const attempt = broker.attempt(
      "iina-window-1",
      providerRequest(a, old.authorityId, old.activationGeneration),
      (value) => progress.push(value),
    );
    await final.waitForPending();
    await authority.set(activationRequest(a, false, "disable-a"));
    await authority.set(activationRequest(a, true, "activate-a-2"));
    publishProgress?.({ translations: [{ id: "cue-1", text: "late" }] });
    final.releaseNext({ translations: [{ id: "cue-1", text: "late-final" }] });

    await expect(attempt).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(progress).toEqual([]);
    expect(authority.snapshot.activation?.profileId).toBe(a.profileId);
    expect(authority.snapshot.activationGeneration).toBe(3);
  });

  it("atomically deletes the active Profile and clears the shared activation", async () => {
    const { authority, a, b, c, d, commits } = setup();
    await authority.set(activationRequest(a, true, "window-1-activate-a"));

    const deletion = await authority.deleteProfile(a.profileId, a.revision);

    expect(deletion.outcome).toBe("changed");
    expect(authority.snapshot.activation).toBeNull();
    expect(authority.snapshot.profiles.map((profile) => profile.profileId)).toEqual([
      b.profileId,
      c.profileId,
      d.profileId,
    ]);
    expect(commits.at(-1)).toMatchObject({
      activation: null,
      profiles: [
        { profileId: b.profileId, revision: b.revision },
        { profileId: c.profileId, revision: c.revision },
        { profileId: d.profileId, revision: d.revision },
      ],
    });
  });

  it("deletes a non-active Profile without changing the active generation", async () => {
    const { authority, a, b } = setup();
    await authority.set({
      ...activationRequest(a, true, "window-1-activate-a"),
      senderId: "iina-window-1",
    });
    const generation = authority.snapshot.activationGeneration;

    const deletion = await authority.deleteProfile(b.profileId, b.revision);

    expect(deletion.outcome).toBe("changed");
    expect(authority.snapshot.activation?.profileId).toBe(a.profileId);
    expect(authority.snapshot.activationGeneration).toBe(generation);
  });

  it("rejects a stale window deletion after another window commits a new revision", async () => {
    const { authority, b } = setup();
    const updated = await authority.saveProfile({
      profileId: b.profileId,
      expectedRevision: b.revision,
      displayName: "B updated",
      kind: b.kind,
      endpoint: b.endpoint,
      proxyMode: b.proxyMode,
      model: b.model,
    });

    const staleDeletion = await authority.deleteProfile(b.profileId, b.revision);

    expect(updated.outcome).toBe("changed");
    expect(staleDeletion.outcome).toBe("failed");
    expect(authority.snapshot.profiles).toContainEqual(
      expect.objectContaining({ profileId: b.profileId, revision: b.revision + 1 }),
    );
  });
});
