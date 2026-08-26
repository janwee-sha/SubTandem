import type { ConfiguredProvider } from "./provider.js";
import type { ProviderAttemptError, ProviderProfileSnapshot } from "./types.js";

type ProviderBuilder = (profile: ProviderProfileSnapshot) => Promise<ConfiguredProvider>;

export class CredentialScopedProviderCache {
  private readonly providers = new Map<string, Promise<ConfiguredProvider>>();

  constructor(
    private readonly credentialEpochFor: (profileId: string) => number,
    private readonly build: ProviderBuilder,
  ) {}

  get(profile: ProviderProfileSnapshot): Promise<ConfiguredProvider> {
    const credentialEpoch = this.credentialEpochFor(profile.profileId);
    const key = `${profile.profileId}\u0000${profile.revision}\u0000${credentialEpoch}`;
    const cached = this.providers.get(key);
    if (cached) return cached;
    const created = this.build(profile).then((provider) => {
      if (this.credentialEpochFor(profile.profileId) !== credentialEpoch)
        throw {
          category: "cancelled",
          retryable: false,
          providerCode: "CREDENTIAL_CONTEXT_CHANGED",
          userAction: "RETRY",
        } satisfies ProviderAttemptError;
      return provider;
    });
    this.providers.set(key, created);
    void created.catch(() => {
      if (this.providers.get(key) === created) this.providers.delete(key);
    });
    return created;
  }

  clearProfile(profileId: string): void {
    for (const key of this.providers.keys())
      if (key.startsWith(`${profileId}\u0000`)) this.providers.delete(key);
  }
}
