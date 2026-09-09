import {
  createLanguageDetectionWork,
  type LanguageDetectionResult,
  type LanguageDetectionWork,
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

export interface LanguageDetectionMetrics {
  readonly kind: "first" | "repeat";
  readonly elapsedMs: number;
  readonly stepDurationsMs: readonly number[];
  readonly state: LanguageDetectionResult["state"];
}

interface ActiveAttempt {
  readonly playerId: string;
  readonly mediaEpoch: number;
  readonly trackIdentity: string;
  readonly contentHash: string;
  readonly attemptId: string;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly kind: "first" | "repeat";
  work: LanguageDetectionWork | null;
}

export class LanguageDetectionCoordinator {
  private sequence = 0;
  private active: ActiveAttempt | null = null;
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly createWork: (cues: readonly SubtitleCue[]) => LanguageDetectionWork;
  private readonly onMetrics: ((metrics: LanguageDetectionMetrics) => void) | undefined;

  constructor(
    options: {
      readonly now?: () => number;
      readonly yieldControl?: () => Promise<void>;
      readonly createWork?: (cues: readonly SubtitleCue[]) => LanguageDetectionWork;
      readonly onMetrics?: (metrics: LanguageDetectionMetrics) => void;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.yieldControl =
      options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    this.createWork = options.createWork ?? createLanguageDetectionWork;
    this.onMetrics = options.onMetrics;
  }

  get currentAttempt(): Omit<Readonly<ActiveAttempt>, "work"> | null {
    if (!this.active) return null;
    const { work, ...identity } = this.active;
    void work;
    return identity;
  }

  start(
    input: LanguageDetectionInput,
    commit: (result: CoordinatedLanguageDetectionResult) => void,
  ): Promise<void> {
    this.invalidate();
    const startedAt = this.now();
    const attempt: ActiveAttempt = {
      playerId: input.playerId,
      mediaEpoch: input.mediaEpoch,
      trackIdentity: input.trackIdentity,
      contentHash: input.contentHash,
      attemptId: `language-detection-${++this.sequence}`,
      startedAt,
      deadlineAt: startedAt + 500,
      kind: this.sequence === 1 ? "first" : "repeat",
      work: null,
    };
    this.active = attempt;
    try {
      attempt.work = this.createWork(input.cues);
    } catch {
      this.finish(attempt, { state: "unknown" }, [], commit);
      return Promise.resolve();
    }
    return this.run(attempt, commit);
  }

  private async run(
    attempt: ActiveAttempt,
    commit: (result: CoordinatedLanguageDetectionResult) => void,
  ): Promise<void> {
    const durations: number[] = [];
    let previousPhase = "";
    let batchStartedAt = this.now();
    let batchSteps = 0;
    let longestStep = 16;
    try {
      while (this.isCurrent(attempt)) {
        const before = this.now();
        if (before + longestStep >= attempt.deadlineAt) {
          this.finish(attempt, { state: "unknown" }, durations, commit);
          return;
        }
        const next = attempt.work!.next();
        const after = this.now();
        const elapsed = Math.max(0, after - before);
        durations.push(elapsed);
        longestStep = Math.max(longestStep, elapsed);
        if (!this.isCurrent(attempt)) return;
        if (after >= attempt.deadlineAt) {
          this.finish(attempt, { state: "unknown" }, durations, commit);
          return;
        }
        if (next.done) {
          this.finish(attempt, next.value, durations, commit);
          return;
        }
        batchSteps += 1;
        if (next.value.phase !== previousPhase || after - batchStartedAt >= 4 || batchSteps >= 8) {
          previousPhase = next.value.phase;
          await this.yieldControl();
          if (!this.isCurrent(attempt)) return;
          batchStartedAt = this.now();
          batchSteps = 0;
        }
      }
    } catch {
      this.finish(attempt, { state: "unknown" }, durations, commit);
    } finally {
      attempt.work?.dispose();
      attempt.work = null;
      durations.length = 0;
    }
  }

  private finish(
    attempt: ActiveAttempt,
    result: LanguageDetectionResult,
    durations: readonly number[],
    commit: (result: CoordinatedLanguageDetectionResult) => void,
  ): void {
    if (!this.isCurrent(attempt)) return;
    attempt.work?.dispose();
    attempt.work = null;
    this.active = null;
    try {
      commit({ ...result, contentHash: attempt.contentHash, attemptId: attempt.attemptId });
      this.onMetrics?.({
        kind: attempt.kind,
        elapsedMs: Math.max(0, this.now() - attempt.startedAt),
        stepDurationsMs: [...durations],
        state: result.state,
      });
    } catch {
      return;
    }
  }

  invalidate(): void {
    this.active?.work?.dispose();
    if (this.active) this.active.work = null;
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
