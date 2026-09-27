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
  const replies: Array<{ sender: unknown; name: string; data: any }> = [];
  const ready = new CompletionQueue<string, void>();
  const readyGate = pauseReady ? ready.hold("ready").promise : Promise.resolve();
  const transport = new RequestLifecycleHarness();
  const secrets = new CompletionQueue<string, Record<string, string> | null>();
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
    HelperProfileStateStore: class {},
    HelperCredentialStore: class {
      async setSecret(_id: string, _fields: unknown, options: { expectedStoreRevision: number }) {
        return {
          state: "committed",
          initialized: true,
          storeRevision: options.expectedStoreRevision + 1,
          lastCommit: null,
          profileState: { profiles: profiles.listLatest(), activation: null },
          credentialConfigured: Object.fromEntries(
            profiles.listLatest().map((profile) => [profile.profileId, true]),
          ),
        };
      }
      getSecret(id: string) {
        reads.push(id);
        return secrets.hold(id).promise;
      }
    },
  }));
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
    get authority() {
      return authority;
    },
    replies,
    ready,
    secrets,
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
