import { RequestLifecycle } from "./request-lifecycle.js";
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

export class ProviderBroker {
  private readonly requests = new RequestLifecycle<{ profileId: string }>();

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
    assertAuthorized?: () => void,
  ): Promise<TranslationBatchResult> {
    if (!this.authority.isAuthorized(request)) throw new ProviderBrokerError("PROFILE_NOT_ACTIVE");
    const profile = this.profiles.get(request.profileId, request.profileRevision);
    if (!profile || profile.endpointFingerprint !== request.endpointFingerprint)
      throw new ProviderBrokerError("PROFILE_NOT_FOUND");
    const owner = this.requests.begin({
      senderId: authoritativePlayerId,
      operation: "translation",
      requestId: request.requestId,
      context: { profileId: profile.profileId },
      assertAuthorized,
    });
    if (!owner) throw new ProviderBrokerError("DUPLICATE_REQUEST");
    const providerRequestId = `${authoritativePlayerId.length}:${authoritativePlayerId}${request.requestId}`;
    const guard = () => {
      try {
        this.requests.assertActive(
          owner,
          () =>
            this.authority.isAuthorized(request) &&
            this.profiles.get(request.profileId)?.revision === request.profileRevision,
        );
      } catch {
        throw new ProviderBrokerError("REQUEST_CANCELLED");
      }
    };
    try {
      guard();
      const provider = await this.createProvider(profile);
      guard();
      this.requests.track(owner, providerRequestId, () => provider.cancel?.(providerRequestId));
      const result = await provider.attempt(
        { ...request, requestId: providerRequestId as TranslationBatchRequest["requestId"] },
        (progress) => {
          try {
            guard();
          } catch {
            return;
          }
          onProgress?.(progress);
        },
        guard,
      );
      guard();
      return result;
    } finally {
      this.requests.finish(owner);
    }
  }

  async cancel(authoritativePlayerId: string, requestId: string): Promise<void> {
    await this.requests.cancel(authoritativePlayerId, "translation", requestId);
  }

  async cancelAll(): Promise<void> {
    await this.requests.cancelWhere(() => true);
  }

  async cancelProfile(profileId: string): Promise<void> {
    await this.requests.cancelWhere((owner) => owner.context.profileId === profileId);
  }

  async releaseSender(senderId: string): Promise<void> {
    await this.requests.releaseSender(senderId);
  }
}
