import type * as SupervisorModule from "../../src/transport/supervisor.js";
import { CredentialPeer } from "./credential-peer.js";
import { CredentialEditor } from "../../ui/credential-editor.js";
import { validateProfileSave, profileSaveRequestDigest } from "../../src/transport/client.js";
import type { CredentialEnvelope, CredentialOwner } from "../../shared/credential-protocol.js";
import type { SaveProfileInput } from "../../src/providers/profiles.js";
import { vi } from "vitest";
import {
  CompletionQueue,
  createTestProfileAuthority,
  activateTestProfile,
} from "./profile-activation-harness.js";
import { RequestLifecycleHarness } from "./provider-request-lifecycle.js";
import type { ProviderProfiles } from "../../src/providers/profiles.js";
import type { ProviderProfileSnapshot } from "../../src/providers/types.js";

export async function globalProviderHarness(
  saved: ProviderProfileSnapshot[] = [],
  pauseReady = false,
  activateSaved = false,
) {
  vi.resetModules();
  const handlers = new Map<string, (data: unknown, sender?: string) => unknown>();
  const closed: Array<(sender: string) => void> = [];
  const startup: Array<() => unknown> = [];
  const editors = new Map<string, Map<string, (value: unknown) => void>>();
  const peer = new CredentialPeer();
  const saveCalls: Array<{ owner: CredentialOwner; frame: CredentialEnvelope }> = [];
  const replies: Array<{ sender: unknown; name: string; data: any }> = [];
  const ready = new CompletionQueue<string, void>();
  const readyGate = pauseReady ? ready.hold("ready").promise : Promise.resolve();
  const transport = new RequestLifecycleHarness();
  const reads: string[] = [];
  let profiles!: ProviderProfiles;
  let authority!: ReturnType<typeof createTestProfileAuthority>;
  vi.stubGlobal("iina", {
    preferences: { get: () => undefined, set: vi.fn(), sync: vi.fn() },
    file: {},
  });
  vi.doMock("../../src/adapters/iina/global-mailbox.js", () => ({
    GlobalMailbox: class {
      onMessage(name: string, callback: (data: unknown, sender?: string) => unknown) {
        handlers.set(name, callback);
      }
      onSessionClose(callback: (sender: string) => void) {
        closed.push(callback);
      }
      postMessage(sender: unknown, name: string, data: unknown) {
        replies.push({ sender, name, data });
        if (typeof sender === "string") editors.get(sender)?.get(name)?.(data);
      }
    },
    IinaGlobalMailboxFileStore: class {},
  }));
  vi.doMock("../../src/adapters/iina/host-timers.js", () => ({
    hostTimers: {
      setTimeout: (callback: () => unknown) => {
        startup.push(callback);
        return { cancel() {} };
      },
      setInterval: () => ({ cancel() {} }),
    },
  }));
  vi.doMock("../../src/adapters/iina/provider-transport.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    HelperProviderTransport: class {
      request = transport.request.bind(transport);
      cancel = transport.cancel.bind(transport);
    },
  }));
  vi.doMock("../../src/credentials/store.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    HelperProfileStateStore: class {
      async save(owner: CredentialOwner, frame: CredentialEnvelope) {
        saveCalls.push({ owner, frame });
        const snapshot = validateProfileSave(owner, frame);
        const submission = snapshot.save!;
        const value = peer.open(owner, frame);
        const previous = authority.snapshot.profiles;
        const target =
          snapshot.sourceProfile?.profileId ??
          submission.profileState.profiles.find(
            (profile) => !previous.some((old) => old.profileId === profile.profileId),
          )!.profileId;
        return {
          state: "committed",
          initialized: true,
          storeRevision: submission.expectedStoreRevision + 1,
          profileState: structuredClone(submission.profileState),
          credentialConfigured: Object.fromEntries(
            submission.profileState.profiles.map((profile) => [
              profile.profileId,
              profile.profileId === target
                ? Boolean(value)
                : (previous.find((old) => old.profileId === profile.profileId)
                    ?.credentialConfigured ?? false),
            ]),
          ),
          lastCommit: {
            commitId: submission.commitId,
            operation: "save-profile",
            baseRevision: submission.expectedStoreRevision,
            requestDigest: profileSaveRequestDigest(owner, frame),
          },
        };
      }
    },
  }));
  vi.doMock("../../src/transport/supervisor.js", async (original) => {
    const { TransportSupervisor } = await original<typeof SupervisorModule>();
    return {
      TransportSupervisor: class extends TransportSupervisor {
        credentialChannel(action: string, payload: unknown) {
          return peer.call(action, payload);
        }
      },
    };
  });
  vi.doMock("../../src/providers/profile-activation.js", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    restoreProfileActivationAuthority: async (options: { profiles: ProviderProfiles }) => {
      profiles = options.profiles;
      await readyGate;
      profiles.hydrate(saved);
      authority = createTestProfileAuthority(profiles);
      if (activateSaved && saved[0]) await activateTestProfile(authority, saved[0]);
      return authority;
    },
  }));
  await import("../../src/global.js");
  return {
    transport,
    saveCalls,
    async save(input: SaveProfileInput, value = "", sender = "editor-window") {
      const listeners = new Map<string, (data: unknown) => void>();
      editors.set(sender, listeners);
      const editor = new CredentialEditor({
        onMessage: (name, callback) => listeners.set(name, callback),
        postMessage: (name, data) => {
          void handlers.get(name)?.(data, sender);
        },
      });
      const previous = input.profileId ? profiles.get(input.profileId) : undefined;
      try {
        return await editor.save(
          value,
          {
            ...(input.profileId
              ? { profileId: input.profileId, expectedRevision: input.expectedRevision }
              : {}),
            displayName: input.displayName,
            kind: input.kind,
            endpoint: input.endpoint,
            model: input.model ?? "",
            proxyMode: input.proxyMode ?? "system",
          },
          {
            drawerId: "synthetic-drawer",
            sourceProfile: previous
              ? {
                  profileId: previous.profileId,
                  profileRevision: previous.revision,
                  endpointFingerprint: previous.endpointFingerprint,
                }
              : null,
            draftRevision: 1,
            keyEditEpoch: 1,
            submitEpoch: 1,
          },
          "synthetic-save-request",
        );
      } finally {
        editor.close();
        editors.delete(sender);
      }
    },
    get authority() {
      return authority;
    },
    replies,
    ready,
    reads,
    startup,
    get profiles() {
      return profiles;
    },
    send: async (name: string, payload: unknown, sender = "window", requestId = "request") => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`MISSING_HANDLER:${name}`);
      return handler({ requestId, revision: 1, payload }, sender);
    },
    close: (sender: string) => closed.forEach((callback) => callback(sender)),
  };
}
