import {
  SubtitleExtractorError,
  type SubtitleExtractorRpcClient,
} from "../adapters/iina/subtitle-extractor.js";
import { loadPreparedSubtitleSource } from "../subtitles/source.js";
import type {
  MediaSessionIdentity,
  PreparedSubtitleSource,
  SourcePreparationView,
  SubtitlePreparationAttempt,
  SubtitlePreparationState,
  SubtitleTrackIdentity,
} from "../subtitles/types.js";

export interface SubtitlePreparationCoordinatorOptions {
  playerId: string;
  extractor: SubtitleExtractorRpcClient;
  readResult(resultId: string): Uint8Array | null;
  createId?: () => string;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface ActivePreparation {
  media: MediaSessionIdentity;
  track: SubtitleTrackIdentity;
  attempt: SubtitlePreparationAttempt;
}

function fallbackUuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function retryable(state: SubtitlePreparationState): boolean {
  return state === "emptyOrUnreadable" || state === "timedOut" || state === "failed";
}

function sameTrack(left: SubtitleTrackIdentity, right: SubtitleTrackIdentity): boolean {
  return (
    left.trackId === right.trackId &&
    left.origin === right.origin &&
    left.codec === right.codec &&
    left.ffIndex === right.ffIndex &&
    left.sourceId === right.sourceId
  );
}

function safeState(error: unknown): SubtitlePreparationState {
  if (!(error instanceof SubtitleExtractorError)) return "failed";
  if (error.code === "EMPTY_OR_UNREADABLE" || error.code === "OUTPUT_LIMIT")
    return "emptyOrUnreadable";
  if (error.code === "TIMED_OUT") return "timedOut";
  return "failed";
}

export class SubtitlePreparationCoordinator {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly setTimer: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private active: ActivePreparation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private prepared: PreparedSubtitleSource | null = null;
  private publicView: SourcePreparationView | null = null;

  constructor(private readonly options: SubtitlePreparationCoordinatorOptions) {
    this.createId = options.createId ?? fallbackUuid;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  get view(): SourcePreparationView | null {
    return this.publicView ? { ...this.publicView } : null;
  }

  get source(): PreparedSubtitleSource | null {
    return this.prepared;
  }

  async prepare(
    media: MediaSessionIdentity,
    track: SubtitleTrackIdentity,
  ): Promise<PreparedSubtitleSource | null> {
    if (
      media.playerId !== this.options.playerId ||
      media.isNetworkResource ||
      track.origin !== "embedded" ||
      track.codec === "external" ||
      track.ffIndex === undefined
    ) {
      this.setState(media.isNetworkResource ? "remoteUnsupported" : "unsupportedType", track);
      return null;
    }
    this.invalidate("invalidated");
    const attemptId = this.createId();
    const jobId = this.createId();
    const startedAt = this.now();
    const attempt: SubtitlePreparationAttempt = {
      attemptId,
      mediaEpoch: media.mediaEpoch,
      trackIdentity: { ...track },
      startedAt,
      deadlineAt: startedAt + 15_000,
      status: "preparing",
      jobId,
    };
    this.active = { media: { ...media }, track: { ...track }, attempt };
    this.prepared = null;
    this.setState("preparing", track);

    const nativeOutcome = this.options.extractor
      .prepare({
        jobId,
        mediaPath: media.localPath,
        stream: {
          ffIndex: track.ffIndex,
          sourceId: track.codec === "mov_text" ? (track.sourceId ?? null) : null,
          codec: track.codec,
        },
        deadlineMs: 15_000,
        maxCueCount: 20_000,
        maxOutputBytes: 16_777_216,
      })
      .then(
        (result) => ({ type: "result" as const, result }),
        (error: unknown) => ({ type: "error" as const, error }),
      );
    const timeoutOutcome = new Promise<{ type: "timeout" }>((resolve) => {
      this.timer = this.setTimer(() => {
        if (!this.accepts(media, track, attemptId)) return;
        attempt.status = "timedOut";
        this.setState("timedOut", track);
        void this.options.extractor.cancel(jobId).catch(() => undefined);
        resolve({ type: "timeout" });
      }, 15_000);
    });
    const outcome = await Promise.race([nativeOutcome, timeoutOutcome]);
    if (outcome.type === "timeout") {
      void nativeOutcome.then((late) => {
        if (late.type === "result")
          void this.options.extractor.release(late.result.resultId).catch(() => undefined);
      });
      return null;
    }
    this.stopTimer();
    if (outcome.type === "error") {
      if (this.accepts(media, track, attemptId)) {
        attempt.status = safeState(outcome.error);
        this.setState(attempt.status, track);
      }
      return null;
    }
    const result = outcome.result;
    if (!this.accepts(media, track, attemptId) || this.now() > attempt.deadlineAt) {
      await this.safeRelease(result.resultId);
      return null;
    }
    const bytes = this.options.readResult(result.resultId);
    const prepared = bytes ? loadPreparedSubtitleSource(track, bytes, result) : null;
    await this.safeRelease(result.resultId);
    if (!prepared || !this.accepts(media, track, attemptId)) {
      if (this.accepts(media, track, attemptId)) {
        attempt.status = "emptyOrUnreadable";
        this.setState("emptyOrUnreadable", track);
      }
      return null;
    }
    attempt.status = "ready";
    this.prepared = prepared;
    this.setState("ready", track, prepared.cues.length);
    return prepared;
  }

  retry(): Promise<PreparedSubtitleSource | null> {
    if (!this.active || !retryable(this.active.attempt.status)) return Promise.resolve(null);
    const { media, track } = this.active;
    return this.prepare(media, track);
  }

  invalidateForSelection(media: MediaSessionIdentity, track: SubtitleTrackIdentity): void {
    if (
      !this.active ||
      this.active.media.playerId !== media.playerId ||
      this.active.media.mediaEpoch !== media.mediaEpoch ||
      !sameTrack(this.active.track, track)
    )
      this.invalidate("invalidated");
  }

  invalidate(state: "invalidated" | "timedOut" = "invalidated"): void {
    this.stopTimer();
    const previous = this.active;
    this.prepared = null;
    if (!previous) return;
    previous.attempt.status = state;
    this.setState(state, previous.track);
    if (previous.attempt.jobId)
      void this.options.extractor.cancel(previous.attempt.jobId).catch(() => undefined);
  }

  onSeek(): void {}

  async shutdown(): Promise<void> {
    this.invalidate("invalidated");
    try {
      await this.options.extractor.shutdown();
    } catch {
      return;
    }
  }

  private accepts(
    media: MediaSessionIdentity,
    track: SubtitleTrackIdentity,
    attemptId: string,
  ): boolean {
    return Boolean(
      this.active &&
      this.active.attempt.attemptId === attemptId &&
      this.active.attempt.status === "preparing" &&
      this.active.media.playerId === media.playerId &&
      this.active.media.mediaEpoch === media.mediaEpoch &&
      sameTrack(this.active.track, track),
    );
  }

  private setState(
    state: SubtitlePreparationState,
    track: SubtitleTrackIdentity,
    cueCount?: number,
  ): void {
    this.publicView = {
      state,
      origin: "embedded",
      ...(track.codec === "external" ? {} : { codec: track.codec }),
      ...(cueCount === undefined ? {} : { cueCount }),
      canRetry: retryable(state),
      canReselect: state !== "ready",
    };
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private async safeRelease(resultId: string): Promise<void> {
    try {
      await this.options.extractor.release(resultId);
    } catch {
      return;
    }
  }
}
