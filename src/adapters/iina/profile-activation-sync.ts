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

  constructor(private readonly initialGetRequestId: string) {}

  get snapshot(): AuthoritySnapshot | null {
    return this.confirmed ? cloneSnapshot(this.confirmed) : null;
  }

  accept(snapshot: AuthoritySnapshot, requestId?: string): boolean {
    if (!this.confirmed) {
      if (requestId !== this.initialGetRequestId) return false;
      this.confirmed = cloneSnapshot(snapshot);
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
    return true;
  }
}
