import { describe, expect, it } from "vitest";
import { ProviderConnectionTests } from "../../src/providers/connection-tests.js";
import type { ConfiguredProvider } from "../../src/providers/provider.js";

function configuredProvider(cancelled: string[]): ConfiguredProvider {
  return {
    attempt: async (request) => ({
      translations: request.items.map((item) => ({ id: item.id, text: item.text })),
    }),
    testConnection: async (testId) => testId,
    cancel: (testId) => {
      cancelled.push(testId);
    },
  };
}

describe("provider connection test registry", () => {
  it("gives colliding external IDs and a shared provider unique internal identities", () => {
    const provider = configuredProvider([]);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "same-request",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "same-request",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });

    expect(first.testId).toBe("test-1");
    expect(second.testId).toBe("test-2");
    expect(registry.activeCount()).toBe(2);
    expect(registry.complete(first.testId)).toEqual(first);
    expect(registry.activeCount()).toBe(1);
    expect(registry.get(second.testId)).toEqual(second);
  });

  it("cancels only matching profile tasks and ignores late completion", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "one",
      profileId: "profile-a",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "two",
      profileId: "profile-b",
      profileRevision: 2,
      provider,
    });

    await registry.cancelProfile("profile-a");

    expect(cancelled).toEqual([first.testId]);
    expect(registry.complete(first.testId)).toBeNull();
    expect(registry.get(second.testId)).toEqual(second);
    expect(second).not.toHaveProperty("selection");
  });

  it("makes individual and global cancellation idempotent", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "one",
      profileId: "profile-a",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "two",
      profileId: "profile-b",
      profileRevision: 1,
      provider,
    });

    await expect(registry.cancel(first.testId)).resolves.toBe(true);
    await expect(registry.cancel(first.testId)).resolves.toBe(false);
    await registry.cancelAll();
    await registry.cancelAll();

    expect(cancelled).toEqual([first.testId, second.testId]);
    expect(registry.activeCount()).toBe(0);
  });

  it("cancels only tests owned by a released player", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "same",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "same",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });

    await registry.cancelPlayer("player-a");

    expect(cancelled).toEqual([first.testId]);
    expect(registry.get(first.testId)).toBeNull();
    expect(registry.get(second.testId)).toEqual(second);
  });
});
