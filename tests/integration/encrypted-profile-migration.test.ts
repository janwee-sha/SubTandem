import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLegacyProviderProfiles, ProviderProfiles } from "../../src/providers/profiles.js";
import { restoreProfileActivationAuthority } from "../../src/providers/profile-activation.js";
import { SubTandemError } from "../../src/domain/errors.js";
import type { ProfileStateCommitResult } from "../../src/transport/client.js";

const id = "10000000-0000-4000-8000-000000000001";
const input = [
  {
    profileId: id,
    displayName: "Retained",
    kind: "openai",
    endpoint: " https://example.test/v1/// ",
    model: " model-a ",
    proxyMode: "direct",
    apiKey: "synthetic-migration-old-key",
    credential: { apiKey: "synthetic-nested-old-key" },
  },
];
const profile = new ProviderProfiles(() => id).save({
  profileId: id,
  expectedRevision: 0,
  displayName: "Retained",
  kind: "openai",
  endpoint: "https://example.test/v1///",
  model: "model-a",
  proxyMode: "direct",
});
const committed = (): ProfileStateCommitResult => ({
  state: "committed",
  initialized: true,
  storeRevision: 8,
  lastCommit: null,
  profileState: { profiles: [profile], activation: null },
  credentialConfigured: { [id]: false },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function globalMigration(
  options: {
    layout?: "profile-state" | "credentials-only";
    state?: ProfileStateCommitResult;
    migrationError?: string;
    preferenceFailure?: "set" | "sync";
    cleanupFailure?: boolean;
  } = {},
) {
  vi.resetModules();
  const { SubTandemError: RuntimeError } = await import("../../src/domain/errors.js");
  const calls: Array<{ action: string; data: unknown }> = [];
  const writes: Array<{ key: string; value: unknown }> = [];
  const handlers = new Map<string, (data: unknown, sender?: string) => unknown>();
  const replies: Array<{ name: string; data: any }> = [];
  const values = new Map<string, unknown>([["providerProfilesJson", JSON.stringify(input)]]);
  let state = options.state;
  vi.stubGlobal("iina", {
    preferences: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        calls.push({ action: "preference-set", data: { key, value } });
        if (options.preferenceFailure === "set") throw new Error("synthetic-preference-failure");
        writes.push({ key, value });
        values.set(key, value);
      },
      sync: () => {
        calls.push({ action: "preference-sync", data: null });
        if (options.preferenceFailure === "sync")
          throw new Error("synthetic-preference-sync-failure");
      },
    },
    file: {},
    utils: {},
  });
  vi.doMock("../../src/adapters/iina/global-mailbox.js", () => ({
    GlobalMailbox: class {
      onMessage(name: string, callback: (data: unknown, sender?: string) => unknown) {
        handlers.set(name, callback);
      }
      onSessionClose() {}
      postMessage(_sender: unknown, name: string, data: unknown) {
        replies.push({ name, data });
      }
    },
    IinaGlobalMailboxFileStore: class {},
  }));
  vi.doMock("../../src/adapters/iina/host-timers.js", () => ({
    hostTimers: { setTimeout: () => ({ cancel() {} }), setInterval: () => ({ cancel() {} }) },
  }));
  vi.doMock("../../src/transport/supervisor.js", () => ({
    TransportSupervisor: class {
      async ready() {}
      async profileStateRead() {
        calls.push({ action: "read", data: null });
        if (state) return structuredClone(state);
        throw new RuntimeError(
          options.layout === "profile-state"
            ? "LEGACY_PROFILE_STATE_REQUIRED"
            : "LEGACY_PREFERENCES_REQUIRED",
          "configuration",
          "NONE",
        );
      }
      async profileStateOpen() {
        calls.push({ action: "open", data: null });
        return structuredClone(state);
      }
      async profileStateMigrate(commitId: string, profiles?: unknown[]) {
        calls.push({ action: "migrate", data: { commitId, profiles } });
        if (options.migrationError)
          throw new RuntimeError(options.migrationError, "configuration", "NONE");
        state = {
          ...committed(),
          migration: {
            migrationId: "10000000-0000-4000-8000-000000000010",
            sourceFormat: 1,
            sourceLayout: options.layout ?? "credentials-only",
            commitState: "committed",
            cleanupState: "pending",
            pendingClasses: [
              "legacy-credentials",
              "legacy-rpc",
              "legacy-mailbox",
              "legacy-preferences",
            ],
          },
        };
        return structuredClone(state);
      }
      async profileStateCleanup(
        commitId: string,
        migrationId: string,
        preferenceConfirmed: boolean,
      ) {
        calls.push({ action: "cleanup", data: { commitId, migrationId, preferenceConfirmed } });
        if (options.cleanupFailure) throw new Error("synthetic-cleanup-failure");
        state!.migration!.pendingClasses = preferenceConfirmed ? [] : ["legacy-preferences"];
        state!.migration!.cleanupState = preferenceConfirmed ? "clean" : "pending";
        return structuredClone(state);
      }
    },
  }));
  await import("../../src/global.js");
  await handlers.get("profiles:list")!(
    { requestId: "migration-list", revision: 1, payload: {} },
    "window-a",
  );
  return { calls, writes, replies, values, state };
}

describe("production legacy metadata migration", () => {
  it("normalizes only whitelist metadata, retains IDs and reconstructs revision and fingerprint", () => {
    const normalized = normalizeLegacyProviderProfiles(JSON.stringify(input));
    expect(normalized).toEqual([profile]);
    expect(JSON.stringify(normalized)).not.toMatch(/apiKey|credential|synthetic.*old-key/);
  });

  it.each([
    "{",
    "{}",
    "null",
    JSON.stringify([{ ...input[0], profileId: "" }]),
    JSON.stringify([...input, ...input]),
  ])("refuses unconfirmable preference metadata without discarding entries: %s", (raw) => {
    expect(() => normalizeLegacyProviderProfiles(raw)).toThrow();
  });

  it("never derives metadata from a v2 restart", async () => {
    const load = vi.fn(() => normalizeLegacyProviderProfiles(JSON.stringify(input)));
    const initialize = vi.fn();
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority",
      profiles: new ProviderProfiles(() => id),
      store: {
        read: async () => committed(),
        open: async () => committed(),
        initialize,
        commit: async () => committed(),
      },
      createCommitId: () => "10000000-0000-4000-8000-000000000099",
      loadLegacyProfiles: load,
    });
    expect(authority.snapshot.ready).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });

  it("takes a credentials-only v1 through migration instead of initializing an empty store", async () => {
    const migrate = vi.fn(async () => committed());
    const initialize = vi.fn();
    const store = {
      read: async () => {
        throw new SubTandemError("LEGACY_PREFERENCES_REQUIRED", "configuration", "NONE");
      },
      open: async () => committed(),
      initialize,
      commit: async () => committed(),
      migrate,
    };
    const authority = await restoreProfileActivationAuthority({
      authorityId: "authority",
      profiles: new ProviderProfiles(() => id),
      store,
      createCommitId: () => "10000000-0000-4000-8000-000000000099",
      loadLegacyProfiles: () => normalizeLegacyProviderProfiles(JSON.stringify(input)),
    });
    expect(migrate).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000099", [profile]);
    expect(authority.snapshot.ready).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each(["profile-state", "credentials-only"] as const)(
    "uses the actual Global preference callbacks after confirmed %s migration",
    async (layout) => {
      const h = await globalMigration({ layout });
      expect(h.calls.map((call) => call.action)).toEqual([
        "read",
        "migrate",
        "preference-set",
        "preference-sync",
        "cleanup",
      ]);
      const migrate = h.calls.find((call) => call.action === "migrate")!.data as {
        profiles?: unknown[];
      };
      expect(migrate.profiles).toEqual(layout === "profile-state" ? undefined : [profile]);
      expect(JSON.stringify(h.calls)).not.toMatch(/synthetic.*old-key|apiKey/);
      expect(h.values.get("providerProfilesJson")).toBe("");
      expect(h.replies.at(-1)!.data.storageStatus).toBeUndefined();
      expect(h.state?.migration?.cleanupState).toBe("clean");
    },
  );

  it.each(["MIGRATION_NOT_COMMITTED", "MIGRATION_UNCONFIRMED"])(
    "keeps the preference source until migration is confirmed: %s",
    async (migrationError) => {
      const h = await globalMigration({ migrationError });
      expect(h.writes).toEqual([]);
      expect(h.calls.map((call) => call.action)).toEqual(["read", "migrate"]);
      expect(h.replies.at(-1)!.data.storageStatus).toBeUndefined();
    },
  );

  it.each(["set", "sync"] as const)(
    "keeps committed profiles available while preference %s cleanup remains pending",
    async (preferenceFailure) => {
      const h = await globalMigration({ preferenceFailure });
      expect(h.state?.profileState?.profiles).toEqual([profile]);
      expect(h.state?.migration?.pendingClasses).toEqual(["legacy-preferences"]);
      expect(h.replies.at(-1)!.data.profiles).toHaveLength(1);
      expect(h.replies.at(-1)!.data.storageStatus).toBeUndefined();
    },
  );

  it("never reimports old preference metadata or clears new configured values during a v2 retry", async () => {
    const h = await globalMigration({ cleanupFailure: true });
    const state = structuredClone(h.state!);
    state.credentialConfigured[id] = true;
    state.profileState!.profiles[0]!.revision = 2;
    const restarted = await globalMigration({ state });
    expect(restarted.calls.map((call) => call.action)).toEqual([
      "read",
      "preference-set",
      "preference-sync",
      "cleanup",
    ]);
    expect(restarted.state?.credentialConfigured[id]).toBe(true);
    expect(restarted.state?.profileState?.profiles[0]?.revision).toBe(2);
    expect(restarted.state?.migration?.cleanupState).toBe("clean");
  });
});
