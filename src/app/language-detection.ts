import {
  createLanguageDetectionWork,
  type LanguageDetectionResult,
  type LanguageDetectionWork,
} from "../subtitles/language-detection.js";
import type { SubtitleCue } from "../subtitles/types.js";

export interface LanguageDetectionInput {
  readonly playerId: string;
  readonly sessionId: string;
  readonly sessionEpoch: number;
  readonly mediaEpoch: number;
  readonly trackIdentity: string;
  readonly contentHash: string;
  readonly sourceReadyAt: number;
  readonly cues: readonly SubtitleCue[];
}
export type CoordinatedLanguageDetectionResult = LanguageDetectionResult & {
  readonly contentHash: string;
  readonly attemptId: string;
};
interface DetectionOwner {
  readonly playerId: string;
  readonly sessionId: string;
  readonly sessionEpoch: number;
  readonly mediaEpoch: number;
  readonly trackIdentity: string;
  readonly contentHash: string;
}
interface ActiveAttempt extends DetectionOwner {
  readonly attemptId: string;
  readonly sourceReadyAt: number;
  readonly workDeadlineAt: number;
  readonly deadlineAt: number;
  readonly completion: Promise<void>;
  readonly resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}
function sameOwner(left: DetectionOwner | null, right: DetectionOwner): boolean {
  return (
    left !== null &&
    left.playerId === right.playerId &&
    left.sessionId === right.sessionId &&
    left.sessionEpoch === right.sessionEpoch &&
    left.mediaEpoch === right.mediaEpoch &&
    left.trackIdentity === right.trackIdentity &&
    left.contentHash === right.contentHash
  );
}
export class LanguageDetectionCoordinator {
  private sequence = 0;
  private active: ActiveAttempt | null = null;
  private completed: DetectionOwner | null = null;
  private readonly now: () => number;
  private readonly yieldControl: () => Promise<void>;
  private readonly createWork: (cues: readonly SubtitleCue[]) => LanguageDetectionWork;
  constructor(
    options: {
      readonly now?: () => number;
      readonly yieldControl?: () => Promise<void>;
      readonly createWork?: (cues: readonly SubtitleCue[]) => LanguageDetectionWork;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.yieldControl =
      options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    this.createWork = options.createWork ?? createLanguageDetectionWork;
  }
  get currentAttempt(): Readonly<
    DetectionOwner & {
      attemptId: string;
      sourceReadyAt: number;
      workDeadlineAt: number;
      deadlineAt: number;
    }
  > | null {
    if (!this.active) return null;
    const {
      playerId,
      sessionId,
      sessionEpoch,
      mediaEpoch,
      trackIdentity,
      contentHash,
      attemptId,
      sourceReadyAt,
      workDeadlineAt,
      deadlineAt,
    } = this.active;
    return {
      playerId,
      sessionId,
      sessionEpoch,
      mediaEpoch,
      trackIdentity,
      contentHash,
      attemptId,
      sourceReadyAt,
      workDeadlineAt,
      deadlineAt,
    };
  }
  start(
    input: LanguageDetectionInput,
    commit: (result: CoordinatedLanguageDetectionResult) => void,
  ): Promise<void> {
    if (sameOwner(this.active, input)) return this.active!.completion;
    if (sameOwner(this.completed, input)) return Promise.resolve();
    this.invalidate();
    let resolve!: () => void;
    const completion = new Promise<void>((done) => {
      resolve = done;
    });
    const attempt: ActiveAttempt = {
      playerId: input.playerId,
      sessionId: input.sessionId,
      sessionEpoch: input.sessionEpoch,
      mediaEpoch: input.mediaEpoch,
      trackIdentity: input.trackIdentity,
      contentHash: input.contentHash,
      attemptId: `language-detection-${++this.sequence}`,
      sourceReadyAt: input.sourceReadyAt,
      workDeadlineAt: input.sourceReadyAt + 450,
      deadlineAt: input.sourceReadyAt + 500,
      completion,
      resolve,
      timer: null,
    };
    this.active = attempt;
    const finish = (result: LanguageDetectionResult): void => {
      if (this.active !== attempt) return;
      this.active = null;
      this.completed = attempt;
      if (attempt.timer !== null) clearTimeout(attempt.timer);
      try {
        commit({ ...result, contentHash: attempt.contentHash, attemptId: attempt.attemptId });
      } finally {
        attempt.resolve();
      }
    };
    const expired = (): boolean =>
      !Number.isFinite(attempt.workDeadlineAt) || this.now() >= attempt.workDeadlineAt;
    const current = (): boolean => this.active === attempt;
    if (expired()) finish({ state: "unknown", reason: "timeout" });
    else {
      attempt.timer = setTimeout(
        () => finish({ state: "unknown", reason: "timeout" }),
        Math.max(0, attempt.workDeadlineAt - this.now()),
      );
      const run = async (): Promise<void> => {
        try {
          if (!current()) return;
          if (expired()) {
            finish({ state: "unknown", reason: "timeout" });
            return;
          }
          const work = this.createWork(input.cues);
          for (;;) {
            if (!current()) return;
            if (expired()) {
              finish({ state: "unknown", reason: "timeout" });
              return;
            }
            const step = work.next();
            if (!current()) return;
            if (expired()) {
              finish({ state: "unknown", reason: "timeout" });
              return;
            }
            if (step.done) {
              finish(step.value);
              return;
            }
            await this.yieldControl();
          }
        } catch {
          finish({ state: "unknown", reason: expired() ? "timeout" : "error" });
        }
      };
      void run();
    }
    return completion;
  }
  invalidate(): void {
    const previous = this.active;
    this.active = null;
    this.completed = null;
    if (previous) {
      if (previous.timer !== null) clearTimeout(previous.timer);
      previous.resolve();
    }
  }
  onSeek(): void {}
}
