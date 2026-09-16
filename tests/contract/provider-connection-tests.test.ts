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

function input(senderId: string, requestId: string) {
  return {
    senderId,
    requestId,
    drawerId: `drawer-${senderId}`,
    draftRevision: 1,
    sourceProfile: {
      profileId: "profile-a",
      profileRevision: 2,
      endpointFingerprint: "fingerprint-a",
    },
    credentialEpoch: 3,
  };
}

describe("provider connection Test coordinator", () => {
  it("registers preparing ownership before a provider exists and starts only while current", () => {
    const registry = new ProviderConnectionTests(() => "test-1");
    const started = registry.begin(input("window-a", "request-a"));

    expect(started?.owner).toMatchObject({ phase: "preparing", provider: null });
    expect(registry.isActive(started!.owner)).toBe(true);
    expect(registry.attachProvider(started!.owner, configuredProvider([]))).toMatchObject({
      phase: "running",
    });
  });

  it("keeps one owner per sender and cancels a replaced running provider", async () => {
    const cancelled: string[] = [];
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.begin(input("window-a", "request-a"))!;
    registry.attachProvider(first.owner, configuredProvider(cancelled));
    const second = registry.begin(input("window-a", "request-b"))!;

    expect(second.replaced).toEqual(first.owner);
    expect(registry.isActive(first.owner)).toBe(false);
    expect(registry.isActive(second.owner)).toBe(true);
    await registry.cancelTask(second.replaced!);
    expect(cancelled).toEqual([first.owner.testId]);
  });

  it("deduplicates request IDs per sender while allowing the same ID in another sender", () => {
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.begin(input("window-a", "same"));
    expect(first).not.toBeNull();
    expect(registry.begin(input("window-a", "same"))).toBeNull();
    expect(registry.begin(input("window-b", "same"))?.owner.testId).toBe("test-2");
  });

  it("cancels an exact request during preparation without starting network later", async () => {
    const registry = new ProviderConnectionTests(() => "test-1");
    const owner = registry.begin(input("window-a", "request-a"))!.owner;

    await expect(registry.cancel("window-a", "request-a")).resolves.toBe(true);
    expect(registry.attachProvider(owner, configuredProvider([]))).toBeNull();
    await expect(registry.cancel("window-a", "request-a")).resolves.toBe(false);
  });

  it("isolates sender cancellation and clears deduplication on window release", async () => {
    const cancelled: string[] = [];
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.begin(input("window-a", "same"))!.owner;
    const second = registry.begin(input("window-b", "same"))!.owner;
    registry.attachProvider(first, configuredProvider(cancelled));
    registry.attachProvider(second, configuredProvider(cancelled));

    await registry.releaseSender("window-a");
    expect(cancelled).toEqual([first.testId]);
    expect(registry.isActive(second)).toBe(true);
    expect(registry.begin(input("window-a", "same"))).not.toBeNull();
  });

  it("retains only safe terminal identity and invalidates active or displayed Profile results", async () => {
    const cancelled: string[] = [];
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const completed = registry.begin(input("window-a", "completed"))!.owner;
    registry.attachProvider(completed, configuredProvider(cancelled));
    expect(registry.complete(completed)).toEqual(completed);
    const active = registry.begin(input("window-b", "active"))!.owner;
    registry.attachProvider(active, configuredProvider(cancelled));

    const invalidated = await registry.invalidateProfile("profile-a");

    expect(invalidated.map((owner) => owner.requestId).sort()).toEqual(["active", "completed"]);
    expect(cancelled).toEqual([active.testId]);
    expect(invalidated.every((owner) => !("apiKey" in owner))).toBe(true);
  });

  it("reports invalidated ownership before waiting for provider cancellation", async () => {
    let resolveCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const registry = new ProviderConnectionTests(() => "test-1");
    const owner = registry.begin(input("window-a", "active"))!.owner;
    registry.attachProvider(owner, {
      ...configuredProvider([]),
      cancel: () => cancellation,
    });
    const reported: string[][] = [];

    const invalidation = registry.invalidateProfile("profile-a", (identities) => {
      reported.push(identities.map((identity) => identity.requestId));
    });

    expect(reported).toEqual([["active"]]);
    expect(registry.isActive(owner)).toBe(false);
    resolveCancellation?.();
    await expect(invalidation).resolves.toHaveLength(1);
  });
});
