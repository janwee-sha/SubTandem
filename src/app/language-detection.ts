import {
  detectSubtitleLanguage,
  type LanguageDetectionResult,
} from "../subtitles/language-detection.js";
import type { SubtitleCue } from "../subtitles/types.js";

export interface LanguageDetectionInput {
  readonly playerId: string;
  readonly mediaEpoch: number;
  readonly trackIdentity: string;
  readonly contentHash: string;
  readonly cues: readonly SubtitleCue[];
}

export type CoordinatedLanguageDetectionResult = LanguageDetectionResult & {
  readonly contentHash: string;
  readonly attemptId: string;
};

interface ActiveAttempt {
  readonly playerId: string;
  readonly mediaEpoch: number;
  readonly trackIdentity: string;
  readonly contentHash: string;
  readonly attemptId: string;
  readonly deadlineAt: number;
}

export class LanguageDetectionCoordinator {
  private sequence = 0;
  private active: ActiveAttempt | null = null;
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly detect: (cues: readonly SubtitleCue[]) => LanguageDetectionResult;

  constructor(
    options: {
      readonly now?: () => number;
      readonly yieldControl?: () => Promise<void>;
      readonly detect?: (cues: readonly SubtitleCue[]) => LanguageDetectionResult;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.yieldControl =
      options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    this.detect = options.detect ?? detectSubtitleLanguage;
  }

  get currentAttempt(): Readonly<ActiveAttempt> | null {
    return this.active ? { ...this.active } : null;
  }

  async start(
    input: LanguageDetectionInput,
    commit: (result: CoordinatedLanguageDetectionResult) => void,
  ): Promise<void> {
    const attempt: ActiveAttempt = {
      playerId: input.playerId,
      mediaEpoch: input.mediaEpoch,
      trackIdentity: input.trackIdentity,
      contentHash: input.contentHash,
      attemptId: `language-detection-${++this.sequence}`,
      deadlineAt: this.now() + 500,
    };
    this.active = attempt;
    for (let slice = 0; slice < 4; slice += 1) {
      await this.yieldControl();
      if (!this.isCurrent(attempt)) return;
      if (this.now() > attempt.deadlineAt) {
        commit({
          state: "unknown",
          contentHash: attempt.contentHash,
          attemptId: attempt.attemptId,
        });
        this.active = null;
        return;
      }
    }
    const result = this.detect(input.cues);
    if (!this.isCurrent(attempt)) return;
    if (this.now() > attempt.deadlineAt) {
      commit({ state: "unknown", contentHash: attempt.contentHash, attemptId: attempt.attemptId });
    } else {
      commit({ ...result, contentHash: attempt.contentHash, attemptId: attempt.attemptId });
    }
    if (this.isCurrent(attempt)) this.active = null;
  }

  invalidate(): void {
    this.active = null;
  }

  onSeek(): void {}

  private isCurrent(attempt: ActiveAttempt): boolean {
    return (
      this.active?.attemptId === attempt.attemptId &&
      this.active.playerId === attempt.playerId &&
      this.active.mediaEpoch === attempt.mediaEpoch &&
      this.active.trackIdentity === attempt.trackIdentity &&
      this.active.contentHash === attempt.contentHash
    );
  }
}
