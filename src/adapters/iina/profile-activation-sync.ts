import type { AuthoritySnapshot } from "../../domain/types.js";

function cloneSnapshot(snapshot: AuthoritySnapshot): AuthoritySnapshot {
  return {
    ...snapshot,
    activation: snapshot.activation ? { ...snapshot.activation } : null,
    profiles: snapshot.profiles.map((profile) => ({
      ...profile,
      ...(profile.modelCatalog
        ? {
            modelCatalog: {
              contextKey: profile.modelCatalog.contextKey,
              models: [...profile.modelCatalog.models],
            },
          }
        : {}),
    })),
  };
}

export class ProfileActivationSync {
  private confirmed: AuthoritySnapshot | null = null;
  private deadlineMs: number | null = null;
  private fallbackEntered = false;
  profileListPhase: "initializing" | "settled" = "initializing";

  constructor(
    private initialGetRequestId: string,
    private readonly now = Date.now,
  ) {}

  beginInitialization(): number {
    this.deadlineMs ??= this.now() + 15_000;
    return this.deadlineMs;
  }

  associateGet(requestId: string): void {
    this.initialGetRequestId = requestId;
  }

  enterFallback(immediate = false): boolean {
    if (this.profileListPhase === "settled") return false;
    if (!immediate && (this.deadlineMs === null || this.now() < this.deadlineMs)) return false;
    this.fallbackEntered = true;
    this.profileListPhase = "settled";
    return true;
  }

  get effectiveActivation(): AuthoritySnapshot["activation"] {
    if (
      !this.confirmed?.ready ||
      (this.fallbackEntered && this.confirmed.activationGeneration === 0)
    )
      return null;
    return this.confirmed.activation ? { ...this.confirmed.activation } : null;
  }

  get snapshot(): AuthoritySnapshot | null {
    return this.confirmed ? cloneSnapshot(this.confirmed) : null;
  }

  accept(snapshot: AuthoritySnapshot, requestId?: string): boolean {
    if (
      this.profileListPhase === "initializing" &&
      this.deadlineMs !== null &&
      this.now() >= this.deadlineMs
    )
      this.enterFallback();
    if (!this.confirmed) {
      if (requestId !== this.initialGetRequestId) return false;
      this.confirmed = cloneSnapshot(snapshot);
      if (!snapshot.ready) this.enterFallback(true);
      this.profileListPhase = "settled";
      return true;
    }
    if (
      snapshot.authorityId !== this.confirmed.authorityId ||
      snapshot.stateVersion < this.confirmed.stateVersion
    )
      return false;
    if (snapshot.stateVersion === this.confirmed.stateVersion)
      return JSON.stringify(snapshot) === JSON.stringify(this.confirmed);
    this.confirmed = cloneSnapshot(snapshot);
    this.profileListPhase = "settled";
    return true;
  }
}
