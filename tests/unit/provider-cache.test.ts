import { describe, expect, it, vi } from "vitest";

import { CredentialScopedProviderCache } from "../../src/providers/provider-cache.js";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import type { ProviderProfileSnapshot } from "../../src/providers/types.js";

const profile = {
  profileId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
} as ProviderProfileSnapshot;

describe("credential-scoped Provider cache", () => {
  it("reuses one Provider only within the same Profile revision and credential epoch", async () => {
    let epoch = 0;
    const build = vi.fn(async () => ({}) as ConfiguredProvider);
    const cache = new CredentialScopedProviderCache(() => epoch, build);

    const first = await cache.get(profile);
    expect(await cache.get(profile)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);

    epoch = 1;
    const second = await cache.get(profile);
    expect(second).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("rejects a Provider whose credential epoch changed while it was being built", async () => {
    let epoch = 0;
    let release!: (provider: ConfiguredProvider) => void;
    const pending = new Promise<ConfiguredProvider>((resolve) => {
      release = resolve;
    });
    const cache = new CredentialScopedProviderCache(
      () => epoch,
      () => pending,
    );

    const stale = cache.get(profile);
    epoch = 1;
    cache.clearProfile(profile.profileId);
    release({} as ConfiguredProvider);

    await expect(stale).rejects.toMatchObject({
      category: "cancelled",
      providerCode: "CREDENTIAL_CONTEXT_CHANGED",
    });
  });

  it("clears cached Providers for every revision of one DeepSeek Profile", async () => {
    const build = vi.fn(async () => ({}) as ConfiguredProvider);
    const cache = new CredentialScopedProviderCache(() => 0, build);
    const first = { ...profile, revision: 1, kind: "deepseek" as const };
    const second = { ...profile, revision: 2, kind: "deepseek" as const };
    await cache.get(first);
    await cache.get(second);
    cache.clearProfile(profile.profileId);
    await cache.get(first);
    await cache.get(second);
    expect(build).toHaveBeenCalledTimes(4);
  });
});
