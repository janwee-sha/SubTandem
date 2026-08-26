import { identityHash } from "../domain/identity.js";

export interface CacheIdentity {
  sessionId: string;
  sourceContentHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerSemanticFingerprint: string;
}

export interface SessionCacheEntry extends CacheIdentity {
  cacheKey: string;
  cueId: string;
  translation: string;
}

export class SessionTranslationCache {
  private readonly entries = new Map<string, SessionCacheEntry>();

  constructor(readonly sessionId: string) {}

  private key(identity: CacheIdentity, cueId: string): string {
    return identityHash({ ...identity, cueId });
  }

  get(identity: CacheIdentity, cueId: string): string | undefined {
    if (identity.sessionId !== this.sessionId) return undefined;
    return this.entries.get(this.key(identity, cueId))?.translation;
  }

  insert(
    identity: CacheIdentity,
    results: readonly { cueId: string; translation: string }[],
  ): void {
    if (identity.sessionId !== this.sessionId) return;
    for (const result of results) {
      const translation = result.translation.trim();
      if (!result.cueId || !translation) continue;
      const cacheKey = this.key(identity, result.cueId);
      this.entries.set(cacheKey, { ...identity, cacheKey, cueId: result.cueId, translation });
    }
  }

  clear(): void {
    this.entries.clear();
  }
  get size(): number {
    return this.entries.size;
  }

  toJSON(): { sessionId: string; size: number } {
    return { sessionId: this.sessionId, size: this.size };
  }
}
