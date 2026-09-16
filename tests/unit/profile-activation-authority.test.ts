import { describe, expect, it } from "vitest";
import type { ProfileState } from "../../src/domain/types.js";
import { ProfileActivationAuthority } from "../../src/providers/profile-activation.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import type {
  ProfileStateCommitResult,
  ProfileStateStoreSnapshot,
} from "../../src/transport/client.js";
import { CompletionQueue } from "../helpers/profile-activation-harness.js";

function setup(
  commit: (input: {
    commitId: string;
    expectedStoreRevision: number;
    profileState: ProfileState;
  }) => Promise<ProfileStateCommitResult> = async (input) => committed(input),
) {
  let commitSequence = 0;
  const profiles = new ProviderProfiles(() => `profile-${profiles.listLatest().length + 1}`);
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
  const authority = new ProfileActivationAuthority({
    authorityId: "authority-1",
    profiles,
    storeRevision: 1,
    credentialConfigured: { [a.profileId]: false, [b.profileId]: false },
    activation: null,
    commit,
    createCommitId: () => `00000000-0000-4000-8000-${String(++commitSequence).padStart(12, "0")}`,
  });
  return { authority, a, b };
}

function committed(input: {
  commitId: string;
  expectedStoreRevision: number;
  profileState: ProfileState;
}): ProfileStateCommitResult {
  const snapshot: ProfileStateStoreSnapshot = {
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
      input.profileState.profiles.map((profile) => [profile.profileId, false]),
    ),
  };
  return { state: "committed", ...snapshot };
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

function request(
  profile: ReturnType<ProviderProfiles["save"]>,
  enabled: boolean,
  senderId = "window-a",
  requestId = `request-${profile.displayName}-${enabled}`,
) {
  return {
    senderId,
    requestId,
    authorityId: "authority-1",
    profileId: profile.profileId,
    profileRevision: profile.revision,
    endpointFingerprint: profile.endpointFingerprint,
    enabled,
  };
}

describe("ProfileActivationAuthority", () => {
  it("places a new Profile first, keeps updates in place and never enables on save", async () => {
    const { authority, a, b } = setup();

    const created = await authority.saveProfile({
      displayName: "Created",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "model-created",
      proxyMode: "direct",
    });
    expect(created).toMatchObject({ outcome: "changed" });
    expect(authority.snapshot.profiles.map((value) => value.displayName)).toEqual([
      "Created",
      "A",
      "B",
    ]);
    expect(authority.snapshot.activation).toBeNull();

    await authority.saveProfile({
      profileId: a.profileId,
      expectedRevision: a.revision,
      displayName: "A updated",
      kind: a.kind,
      endpoint: a.endpoint,
      model: a.model,
      proxyMode: "direct",
    });
    expect(authority.snapshot.profiles.map((value) => value.displayName)).toEqual([
      "Created",
      "A updated",
      b.displayName,
    ]);
  });

  it("accepts a committed activation snapshot with native-sorted Profile keys", async () => {
    const { authority, a } = setup(async (input) => sortedKeysClone(committed(input)));

    await expect(authority.set(request(a, true))).resolves.toMatchObject({
      outcome: "changed",
      authority: { ready: true, activation: { profileId: a.profileId } },
    });
  });

  it("commits one global activation and treats exact repeats as unchanged", async () => {
    let commits = 0;
    const { authority, a } = setup(async (input) => {
      commits += 1;
      return committed(input);
    });

    await expect(authority.set(request(a, true))).resolves.toMatchObject({ outcome: "changed" });
    await expect(
      authority.set(request(a, true, "window-b", "request-repeat")),
    ).resolves.toMatchObject({ outcome: "unchanged" });
    expect(authority.snapshot.activation?.profileId).toBe(a.profileId);
    expect(commits).toBe(1);
  });

  it("serializes opposite windows and lets the last confirmed change win", async () => {
    const gates = new CompletionQueue<
      { commitId: string; expectedStoreRevision: number; profileState: ProfileState },
      ProfileStateCommitResult
    >();
    const { authority, a, b } = setup(async (input) => gates.hold(input).promise);

    const enableA = authority.set(request(a, true, "window-a", "request-a"));
    const enableB = authority.set(request(b, true, "window-b", "request-b"));
    await gates.waitForPending();
    const first = gates.pendingInputs[0]!;
    gates.releaseNext(committed(first));
    await expect(enableA).resolves.toMatchObject({ outcome: "changed" });
    await gates.waitForPending();
    const second = gates.pendingInputs[0]!;
    gates.releaseNext(committed(second));
    await expect(enableB).resolves.toMatchObject({ outcome: "changed" });

    expect(authority.snapshot.activation?.profileId).toBe(b.profileId);
    expect(authority.snapshot.activationGeneration).toBe(2);
  });

  it("deduplicates a window request and silently leaves B active for a stale A disable", async () => {
    const gates = new CompletionQueue<
      { commitId: string; expectedStoreRevision: number; profileState: ProfileState },
      ProfileStateCommitResult
    >();
    const { authority, a, b } = setup(async (input) => gates.hold(input).promise);
    const first = authority.set(request(a, true, "window-a", "request-1"));
    await expect(authority.set(request(a, true, "window-a", "request-2"))).resolves.toMatchObject({
      outcome: "pending",
    });
    const duplicate = authority.set(request(a, true, "window-a", "request-1"));
    await gates.waitForPending();
    const firstCommit = gates.pendingInputs[0]!;
    gates.releaseNext(committed(firstCommit));
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      expect.objectContaining({ outcome: "changed" }),
      expect.objectContaining({ outcome: "changed" }),
    ]);
    const switchToB = authority.set(request(b, true, "window-b", "request-3"));
    await gates.waitForPending();
    const secondCommit = gates.pendingInputs[0]!;
    gates.releaseNext(committed(secondCommit));
    await switchToB;

    await expect(authority.set(request(a, false, "window-a", "request-4"))).resolves.toMatchObject({
      outcome: "unchanged",
      authority: { activation: { profileId: b.profileId } },
    });
    expect(gates.pendingCount).toBe(0);
  });

  it("keeps confirmed state on failure and closes admission while reconciling", async () => {
    const failed = setup(async () => {
      throw new Error("private detail");
    });
    await expect(failed.authority.set(request(failed.a, true))).resolves.toMatchObject({
      outcome: "failed",
      authority: { activation: null, ready: true },
    });

    const pending = setup(async (input) => {
      const snapshot = committed(input);
      return { ...snapshot, state: "reconciling" };
    });
    await expect(pending.authority.set(request(pending.a, true))).resolves.toMatchObject({
      outcome: "pending",
      authority: { activation: null, ready: false },
    });
    expect(pending.authority.acceptsTranslations).toBe(false);
  });
});
