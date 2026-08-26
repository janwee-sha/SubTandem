export interface PlaybackFingerprint {
  playerId: string;
  sessionId: string;
  sessionEpoch: number;
  windowEpoch: number;
}

export class PlaybackSession {
  sessionEpoch = 0;
  windowEpoch = 0;
  positionMs: number | null = null;
  paused = false;
  enabled = true;
  closed = false;
  private readonly cancellations = new Set<() => void>();

  constructor(
    readonly playerId: string,
    readonly sessionId: string,
  ) {}

  updatePosition(positionMs: number | null): void {
    this.positionMs =
      positionMs !== null && Number.isFinite(positionMs) && positionMs >= 0 ? positionMs : null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  onSeek(positionMs: number | null): void {
    this.cancelPending();
    this.windowEpoch += 1;
    this.updatePosition(positionMs);
  }

  onTrackChanged(): void {
    this.invalidateSession();
  }
  onFileChanged(): void {
    this.invalidateSession();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.invalidateSession();
  }

  fingerprint(): PlaybackFingerprint {
    return {
      playerId: this.playerId,
      sessionId: this.sessionId,
      sessionEpoch: this.sessionEpoch,
      windowEpoch: this.windowEpoch,
    };
  }

  accepts(fingerprint: PlaybackFingerprint): boolean {
    return (
      !this.closed &&
      this.enabled &&
      fingerprint.playerId === this.playerId &&
      fingerprint.sessionId === this.sessionId &&
      fingerprint.sessionEpoch === this.sessionEpoch &&
      fingerprint.windowEpoch === this.windowEpoch
    );
  }

  registerCancellation(cancel: () => void): () => void {
    this.cancellations.add(cancel);
    return () => this.cancellations.delete(cancel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.enabled = false;
    this.invalidateSession();
  }

  private invalidateSession(): void {
    this.cancelPending();
    this.sessionEpoch += 1;
    this.windowEpoch = 0;
  }

  private cancelPending(): void {
    for (const cancel of this.cancellations) cancel();
    this.cancellations.clear();
  }
}
