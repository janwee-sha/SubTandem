import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackController } from "../../src/app/controller.js";
import { GlobalProviderClient } from "../../src/adapters/iina/global-provider-client.js";
import {
  MainGlobalMailbox,
  type GlobalMailboxFileStore,
} from "../../src/adapters/iina/global-mailbox.js";
import { ProfileActivationSync } from "../../src/adapters/iina/profile-activation-sync.js";
import { parseProfileActivationState } from "../../src/domain/messages.js";
import type { AuthoritySnapshot, ProfileState } from "../../src/domain/types.js";
import type { TranslationBatchRequest } from "../../src/providers/types.js";
import type { ProfileStateCommitResult } from "../../src/transport/client.js";
import { parseSrt } from "../../src/subtitles/srt.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";

vi.mock("../../src/providers/model-discovery.js", () => ({
  discoverProviderModels: vi.fn(async () => []),
}));

async function setup(restoreActive = false) {
  const { HelperCredentialStore, HelperProfileStateStore } =
    await import("../../src/credentials/store.js");
  const { OllamaProvider } = await import("../../src/providers/ollama.js");
  const { ProviderProfiles } = await import("../../src/providers/profiles.js");
  let sequence = 0;
  const profiles = new ProviderProfiles(
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  const a = profiles.save({
    displayName: "A",
    kind: "ollama",
    endpoint: "http://a.test",
    model: "a",
  });
  const b = profiles.save({
    displayName: "B",
    kind: "ollama",
    endpoint: "http://b.test",
    model: "b",
  });
  let stored: ProfileState = {
    profiles: profiles.listLatest(),
    activation: restoreActive
      ? {
          profileId: a.profileId,
          profileRevision: a.revision,
          endpointFingerprint: a.endpointFingerprint,
          kind: a.kind,
          credentialConfigured: false,
        }
      : null,
  };
  let storeRevision = 1;
  const receipt = (commitId: string, operation: "open" | "commit"): ProfileStateCommitResult => ({
    state: "committed",
    initialized: true,
    storeRevision: ++storeRevision,
    lastCommit: { commitId, operation, baseRevision: storeRevision - 1, requestDigest: "safe" },
    profileState: structuredClone(stored),
    credentialConfigured: {},
  });
  vi.spyOn(HelperProfileStateStore.prototype, "read").mockImplementation(async () => ({
    initialized: true,
    storeRevision,
    lastCommit: null,
    profileState: structuredClone(stored),
    credentialConfigured: {},
  }));
  vi.spyOn(HelperProfileStateStore.prototype, "open").mockImplementation(async (id) =>
    receipt(id, "open"),
  );
  const commit = vi
    .spyOn(HelperProfileStateStore.prototype, "commit")
    .mockImplementation(async (id, revision, state) => {
      expect(revision).toBe(storeRevision);
      stored = structuredClone(state);
      return receipt(id, "commit");
    });
  vi.spyOn(HelperCredentialStore.prototype, "getSecret").mockResolvedValue(null);
  const providerAttempt = vi
    .spyOn(OllamaProvider.prototype, "attempt")
    .mockImplementation(async (request) => ({
      translations: request.items.map(({ id, text }) => ({ id, text: `Translated ${text}` })),
    }));
  const delivered: Array<{ target: string | number | null; name: string; data: unknown }> = [];
  const mailboxContents = new Map<string, string>();
  const mailboxFiles: GlobalMailboxFileStore = {
    list: (path) =>
      [...mailboxContents.keys()]
        .filter((item) => item.startsWith(path))
        .map((item) => ({ filename: item.slice(path.length), isDir: false })),
    exists: (path) => mailboxContents.has(path),
    read: (path) => mailboxContents.get(path) ?? null,
    write: (path, content) => {
      mailboxContents.set(path, content);
      if (!path.endsWith(".json") || path.endsWith(".secrets.json")) return;
      const frame = JSON.parse(content) as {
        direction?: unknown;
        targetId?: unknown;
        name?: unknown;
        data?: unknown;
      };
      if (
        frame.direction === "response" &&
        typeof frame.targetId === "string" &&
        typeof frame.name === "string"
      ) {
        delivered.push({
          target: frame.targetId,
          name: frame.name,
          data: structuredClone(frame.data),
        });
      }
    },
    delete: (path) => {
      mailboxContents.delete(path);
    },
  };
  const mailboxes = new Map<string, MainGlobalMailbox>();
  const send = async (sender: string, name: string, data: unknown): Promise<void> => {
    const mailbox = mailboxes.get(sender);
    if (!mailbox) throw new Error(`Missing mailbox: ${sender}`);
    mailbox.postMessage(name, structuredClone(data));
  };
  vi.stubGlobal("iina", {
    preferences: { get: () => undefined },
    file: mailboxFiles,
  });
  await import("../../src/global.js");
  let drainQueue = Promise.resolve();
  const drain = async (): Promise<void> => {
    drainQueue = drainQueue.then(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });
    await drainQueue;
  };
  const window = async (label: string) => {
    const mailbox = new MainGlobalMailbox(mailboxFiles, label);
    mailboxes.set(label, mailbox);
    const client = new GlobalProviderClient(mailbox);
    const controller = new PlaybackController({
      playerId: `main-lifecycle-${label}`,
      provider: client,
      overlay: { clear() {}, show() {} },
      targetLanguage: "zh-Hans",
      requiresProviderSelection: true,
    });
    controller.setEnabled(true);
    const getId = `activation.init.${label}`;
    const sync = new ProfileActivationSync(getId);
    const apply = (snapshot: AuthoritySnapshot, requestId?: string) => {
      const previous = sync.snapshot;
      if (!sync.accept(snapshot, requestId)) return;
      if (
        previous?.ready === snapshot.ready &&
        previous.activationGeneration === snapshot.activationGeneration
      )
        return;
      const active = snapshot.ready ? snapshot.activation : null;
      if (active)
        controller.setProviderSelection({
          profileId: active.profileId,
          revision: active.profileRevision,
          endpointFingerprint: active.endpointFingerprint,
          kind: active.kind,
          authorityId: snapshot.authorityId,
          activationGeneration: snapshot.activationGeneration,
        });
      else controller.clearProviderSelection();
    };
    mailbox.onMessage("profile-activation:state", (raw) => {
      const value = raw as { requestId?: string; authority?: unknown };
      apply(parseProfileActivationState(value.authority ?? raw), value.requestId);
    });
    mailbox.onMessage("profile-activation:result", (raw) => {
      const value = raw as { authority: AuthoritySnapshot };
      apply(parseProfileActivationState(value.authority));
    });
    await send(label, "profile-activation:get", { requestId: getId, revision: 1, payload: {} });
    await drain();
    controller.setSource({
      cues: parseSrt(
        "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:05:00,000 --> 00:05:01,000\nWorld\n",
      ).cues,
      contentHash: "routing-cues",
      language: "en",
      format: "srt",
    });
    return { label, client, controller, sync };
  };
  const activate = async (
    label: string,
    authorityId: string,
    profile: typeof a,
    enabled = true,
  ) => {
    await send(label, "profile-activation:set", {
      requestId: `activation.${label}.${++sequence}`,
      revision: 1,
      payload: {
        authorityId,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        endpointFingerprint: profile.endpointFingerprint,
        enabled,
      },
    });
    await drain();
  };
  return { a, b, window, activate, drain, send, delivered, commit, providerAttempt };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Profile activation through ordinary IINA window routing", () => {
  it("synchronizes old and newly opened windows and continues caching after a remote switch", async () => {
    const host = await setup();
    const first = await host.window("host-1");
    const authorityId = first.sync.snapshot!.authorityId;
    await host.activate(first.label, authorityId, host.a);
    first.controller.tick(1_000);
    await host.drain();
    await first.controller.whenIdle();
    expect(first.controller.cacheSize).toBe(1);

    const [second, third] = await Promise.all([host.window("host-2"), host.window("host-3")]);
    expect(second.sync.snapshot).toEqual(first.sync.snapshot);
    expect(third.sync.snapshot).toEqual(first.sync.snapshot);
    await host.activate(second.label, authorityId, host.b);
    expect(first.sync.snapshot).toEqual(second.sync.snapshot);
    expect(third.sync.snapshot).toEqual(second.sync.snapshot);
    expect(first.sync.snapshot?.activation?.profileId).toBe(host.b.profileId);
    expect(first.controller.cacheSize).toBe(0);

    first.controller.tick(1_000);
    await host.drain();
    await first.controller.whenIdle();
    expect(first.controller.cacheSize).toBe(1);
    first.controller.tick(300_000);
    await host.drain();
    await first.controller.whenIdle();
    expect(first.controller.cacheSize).toBe(2);
    expect(first.controller.providerError).toBeNull();
    expect(host.providerAttempt.mock.calls.at(-1)?.[0].profileId).toBe(host.b.profileId);

    const writes = host.commit.mock.calls.length;
    await host.activate(first.label, authorityId, host.a, false);
    expect(host.commit).toHaveBeenCalledTimes(writes);
    expect(first.sync.snapshot).toEqual(second.sync.snapshot);
    await host.activate(third.label, authorityId, host.b, false);
    expect(first.sync.snapshot?.activation).toBeNull();
    expect(second.sync.snapshot?.activation).toBeNull();
    expect(first.controller.status).toBe("waitingForConfiguration");
    expect(second.controller.status).toBe("waitingForConfiguration");
    expect(third.controller.status).toBe("waitingForConfiguration");
    const attempts = host.providerAttempt.mock.calls.length;
    first.controller.tick(1_000);
    await host.drain();
    expect(host.providerAttempt).toHaveBeenCalledTimes(attempts);
  });

  it("restores simultaneous windows and preserves the last successful concurrent change", async () => {
    const host = await setup(true);
    const windows = await Promise.all([
      host.window("host-1"),
      host.window("host-2"),
      host.window("host-3"),
    ]);
    const authorityId = windows[0]!.sync.snapshot!.authorityId;
    for (const window of windows) {
      expect(window.sync.snapshot?.activation?.profileId).toBe(host.a.profileId);
      expect(window.sync.snapshot).toEqual(windows[0]!.sync.snapshot);
    }
    await Promise.all([
      host.activate("host-1", authorityId, host.b),
      host.activate("host-2", authorityId, host.a),
    ]);
    for (const window of windows) {
      expect(window.sync.snapshot?.activation?.profileId).toBe(host.a.profileId);
      expect(window.sync.snapshot).toEqual(windows[0]!.sync.snapshot);
    }
    const confirmed = windows[0]!.sync.snapshot;
    host.commit.mockRejectedValueOnce(new Error("STORAGE_UNAVAILABLE"));
    await host.activate("host-3", authorityId, host.b);
    for (const window of windows)
      expect(window.sync.snapshot?.activation).toEqual(confirmed?.activation);
    expect(
      host.delivered
        .filter(({ name }) => name === "profile-activation:state")
        .every(({ target }) => typeof target === "string"),
    ).toBe(true);
  });

  it("returns cancellation for an obsolete authorization without invoking the Provider", async () => {
    const host = await setup();
    const first = await host.window("host-1");
    const authorityId = first.sync.snapshot!.authorityId;
    await host.activate(first.label, authorityId, host.a);
    const old = first.sync.snapshot!;
    const second = await host.window("host-2");
    await host.activate(second.label, authorityId, host.b);
    const request: TranslationBatchRequest = {
      ...makeProviderRequest(),
      playerId: "independent-main-id" as TranslationBatchRequest["playerId"],
      authorityId,
      activationGeneration: old.activationGeneration,
      profileId: host.a.profileId,
      profileRevision: host.a.revision,
      endpointFingerprint: host.a.endpointFingerprint,
    };
    const pending = first.client.attempt(request);
    const rejected = pending.catch((error: unknown) => error);
    await host.drain();
    expect(await rejected).toMatchObject({
      category: "cancelled",
      retryable: false,
      providerCode: "PROFILE_NOT_ACTIVE",
    });
    expect(host.providerAttempt).not.toHaveBeenCalled();
  });
});
