import type { PlayerId } from "../domain/types.js";
import type { TranslationProvider } from "./provider.js";
import type { ProviderProfiles } from "./profiles.js";
import type {
  ProviderProfileSnapshot,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "./types.js";

export class ProviderBrokerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class ProviderBroker {
  private readonly active = new Map<
    string,
    {
      provider: TranslationProvider;
      providerRequestId: string;
      profileId: string;
    }
  >();
  private authorizationEpoch = 0;

  constructor(
    private readonly profiles: ProviderProfiles,
    private readonly createProvider: (
      profile: ProviderProfileSnapshot,
    ) => TranslationProvider | Promise<TranslationProvider>,
  ) {}

  select(windowId: string, profileId: string, revision: number, endpointFingerprint: string): void {
    this.profiles.select(windowId, profileId, revision, endpointFingerprint);
  }

  lease(windowId: string, profileId: string, revision: number): void {
    this.profiles.lease(windowId, profileId, revision);
  }

  release(windowId: string, profileId: string, revision: number): void {
    this.profiles.release(windowId, profileId, revision);
  }

  async attempt(
    authoritativePlayerId: string,
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    const selection = this.profiles.selection(authoritativePlayerId);
    if (
      !selection ||
      selection.profileId !== request.profileId ||
      selection.revision !== request.profileRevision ||
      selection.endpointFingerprint !== request.endpointFingerprint
    ) {
      throw new ProviderBrokerError("PROFILE_NOT_SELECTED");
    }
    const profile = this.profiles.get(selection.profileId, selection.revision);
    if (!profile) throw new ProviderBrokerError("PROFILE_NOT_FOUND");
    const epoch = this.authorizationEpoch;
    const provider = await this.createProvider(profile);
    if (epoch !== this.authorizationEpoch)
      throw new ProviderBrokerError("REQUEST_CANCELLED");
    const current = this.profiles.selection(authoritativePlayerId);
    if (
      !current ||
      current.profileId !== selection.profileId ||
      current.revision !== selection.revision ||
      !this.profiles.get(selection.profileId, selection.revision)
    )
      throw new ProviderBrokerError("PROFILE_NOT_SELECTED");
    const key = `${authoritativePlayerId}\u0000${request.requestId}`;
    if (this.active.has(key)) throw new ProviderBrokerError("DUPLICATE_REQUEST");
    const providerRequestId = `${authoritativePlayerId.length}:${authoritativePlayerId}${request.requestId}`;
    const active = { provider, providerRequestId, profileId: profile.profileId };
    this.active.set(key, active);
    try {
      return await provider.attempt(
        {
          ...request,
          playerId: authoritativePlayerId as PlayerId,
          requestId: providerRequestId as TranslationBatchRequest["requestId"],
        },
        (progress) => {
          if (this.active.get(key) === active) onProgress?.(progress);
        },
      );
    } finally {
      if (this.active.get(key) === active) this.active.delete(key);
    }
  }

  async cancel(authoritativePlayerId: string, requestId: string): Promise<void> {
    const key = `${authoritativePlayerId}\u0000${requestId}`;
    const active = this.active.get(key);
    await active?.provider.cancel?.(active.providerRequestId);
    this.active.delete(key);
  }

  async cancelAll(): Promise<void> {
    this.authorizationEpoch += 1;
    const active = [...this.active.entries()];
    this.active.clear();
    await Promise.allSettled(
      active.map(([, request]) => request.provider.cancel?.(request.providerRequestId)),
    );
  }

  async cancelProfile(profileId: string): Promise<void> {
    const active = [...this.active.entries()].filter(
      ([, request]) => request.profileId === profileId,
    );
    for (const [key] of active) this.active.delete(key);
    await Promise.allSettled(
      active.map(([, request]) => request.provider.cancel?.(request.providerRequestId)),
    );
  }
}
