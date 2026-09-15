import { SubTandemError } from "../domain/errors.js";
import type { TranslationProvider } from "./provider.js";
import type { ProfileActivationAuthority } from "./profile-activation.js";
import type { ProviderProfiles } from "./profiles.js";
import type {
  ProviderProfileSnapshot,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationProgressHandler,
} from "./types.js";

export class ProviderBrokerError extends SubTandemError {
  constructor(
    code: "PROFILE_NOT_ACTIVE" | "PROFILE_NOT_FOUND" | "REQUEST_CANCELLED" | "DUPLICATE_REQUEST",
  ) {
    super(code, code === "DUPLICATE_REQUEST" ? "protocol" : "cancelled", "NONE");
  }
}

interface ActiveProviderRequest {
  provider: TranslationProvider | null;
  providerRequestId: string;
  profileId: string;
}

export class ProviderBroker {
  private readonly active = new Map<string, ActiveProviderRequest>();
  private cancellationEpoch = 0;

  constructor(
    private readonly profiles: ProviderProfiles,
    private readonly authority: ProfileActivationAuthority,
    private readonly createProvider: (
      profile: ProviderProfileSnapshot,
    ) => TranslationProvider | Promise<TranslationProvider>,
  ) {}

  async attempt(
    authoritativePlayerId: string,
    request: TranslationBatchRequest,
    onProgress?: TranslationProgressHandler,
  ): Promise<TranslationBatchResult> {
    if (!this.authority.isAuthorized(request)) throw new ProviderBrokerError("PROFILE_NOT_ACTIVE");
    const profile = this.profiles.get(request.profileId, request.profileRevision);
    if (!profile || profile.endpointFingerprint !== request.endpointFingerprint)
      throw new ProviderBrokerError("PROFILE_NOT_FOUND");
    const key = `${authoritativePlayerId}\u0000${request.requestId}`;
    if (this.active.has(key)) throw new ProviderBrokerError("DUPLICATE_REQUEST");
    const providerRequestId = `${authoritativePlayerId.length}:${authoritativePlayerId}${request.requestId}`;
    const active: ActiveProviderRequest = {
      provider: null,
      providerRequestId,
      profileId: profile.profileId,
    };
    const epoch = this.cancellationEpoch;
    this.active.set(key, active);
    try {
      const provider = await this.createProvider(profile);
      active.provider = provider;
      if (
        this.active.get(key) !== active ||
        epoch !== this.cancellationEpoch ||
        !this.authority.isAuthorized(request)
      )
        throw new ProviderBrokerError("REQUEST_CANCELLED");
      const result = await provider.attempt(
        {
          ...request,
          requestId: providerRequestId as TranslationBatchRequest["requestId"],
        },
        (progress) => {
          if (this.active.get(key) === active && this.authority.isAuthorized(request))
            onProgress?.(progress);
        },
      );
      if (this.active.get(key) !== active || !this.authority.isAuthorized(request))
        throw new ProviderBrokerError("REQUEST_CANCELLED");
      return result;
    } finally {
      if (this.active.get(key) === active) this.active.delete(key);
    }
  }

  async cancel(authoritativePlayerId: string, requestId: string): Promise<void> {
    const key = `${authoritativePlayerId}\u0000${requestId}`;
    const active = this.active.get(key);
    this.active.delete(key);
    await active?.provider?.cancel?.(active.providerRequestId);
  }

  async cancelAll(): Promise<void> {
    this.cancellationEpoch += 1;
    const active = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(
      active.map((request) => request.provider?.cancel?.(request.providerRequestId)),
    );
  }

  async cancelProfile(profileId: string): Promise<void> {
    const active = [...this.active.entries()].filter(
      ([, request]) => request.profileId === profileId,
    );
    for (const [key] of active) this.active.delete(key);
    await Promise.allSettled(
      active.map(([, request]) => request.provider?.cancel?.(request.providerRequestId)),
    );
  }
}
