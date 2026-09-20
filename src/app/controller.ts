import type { SessionStatus } from "../domain/status.js";
import { isTargetLanguageId } from "../domain/target-languages.js";
import type { TranslationProvider } from "../providers/provider.js";
import type {
  FrozenTranslationTarget,
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchProgress,
  TranslationBatchResult,
} from "../providers/types.js";
import { selectActiveTranslations } from "../subtitles/active-translations.js";
import type { SubtitleCue } from "../subtitles/types.js";
import { batchCues, selectNearbyCues } from "./scheduler.js";
import { PlaybackSession } from "./playback-session.js";
import { buildProviderRequest, freezeTranslationTargets } from "./request-builder.js";
import { classifyAttemptFailure, retryDelayMs } from "./retry-policy.js";
import { SessionTranslationCache, type CacheIdentity } from "./session-cache.js";
import { TranslationPipeline } from "./translation-pipeline.js";
import { formatTranslationComparison } from "./translation-log.js";
import { hostTimers } from "../adapters/iina/host-timers.js";

export interface ControllerSource {
  cues: SubtitleCue[];
  contentHash: string;
  format: "srt" | "ass";
}

export interface TranslationOverlaySink {
  show(lines: readonly string[]): void;
  clear(): void;
}

export interface PlaybackControllerOptions {
  playerId: string;
  provider: TranslationProvider;
  overlay: TranslationOverlaySink;
  targetLanguage?: string;
  providerSemanticFingerprint?: string;
  authorityId?: string;
  activationGeneration?: number;
  profileId?: string;
  profileRevision?: number;
  endpointFingerprint?: string;
  providerKind?: "openai" | "claude" | "deepseek" | "ollama";
  random?: () => number;
  requiresProviderSelection?: boolean;
  translationLog?: (message: string) => void;
}

export class PlaybackController {
  readonly session: PlaybackSession;
  status: SessionStatus = "waitingForSubtitle";
  private source: ControllerSource | null = null;
  private readonly translations = new Map<string, string>();
  private readonly terminallyFailedCueIds = new Set<string>();
  private lastAttemptError: ProviderAttemptError | null = null;
  private readonly pipeline = new TranslationPipeline();
  private readonly cache: SessionTranslationCache;
  private requestSequence = 0;
  private activeAttempt: Pick<TranslationBatchRequest, "batchId" | "requestId"> | null = null;

  constructor(private readonly options: PlaybackControllerOptions) {
    this.session = new PlaybackSession(
      options.playerId,
      `session-${Date.now()}-${options.playerId}`,
    );
    this.cache = new SessionTranslationCache(this.session.sessionId);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get providerError(): ProviderAttemptError | null {
    return this.lastAttemptError ? { ...this.lastAttemptError } : null;
  }

  setSource(source: ControllerSource | null): void {
    this.session.onTrackChanged();
    this.source = source;
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = this.nextIdleStatus();
  }

  setEnabled(enabled: boolean): void {
    this.session.setEnabled(enabled);
    if (!enabled) {
      this.clearOverlay();
      this.status = "disabled";
    } else {
      this.terminallyFailedCueIds.clear();
      this.lastAttemptError = null;
      this.status = this.nextIdleStatus();
    }
  }

  setTargetLanguage(targetLanguage: string): void {
    this.options.targetLanguage = targetLanguage;
    this.session.onTrackChanged();
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = this.nextIdleStatus();
  }

  setProviderSelection(input: {
    profileId: string;
    revision: number;
    endpointFingerprint: string;
    kind: "openai" | "claude" | "deepseek" | "ollama";
    providerSemanticFingerprint?: string;
    authorityId?: string;
    activationGeneration?: number;
  }): void {
    this.options.profileId = input.profileId;
    this.options.profileRevision = input.revision;
    this.options.endpointFingerprint = input.endpointFingerprint;
    this.options.providerKind = input.kind;
    this.options.authorityId = input.authorityId ?? "legacy-authority";
    this.options.activationGeneration = input.activationGeneration ?? 0;
    this.options.providerSemanticFingerprint =
      input.providerSemanticFingerprint ?? input.endpointFingerprint;
    this.session.onTrackChanged();
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = this.nextIdleStatus();
  }

  clearProviderSelection(): void {
    delete this.options.profileId;
    delete this.options.profileRevision;
    delete this.options.endpointFingerprint;
    delete this.options.providerKind;
    delete this.options.authorityId;
    delete this.options.activationGeneration;
    delete this.options.providerSemanticFingerprint;
    this.session.onTrackChanged();
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = this.session.enabled ? "waitingForConfiguration" : "disabled";
  }

  private nextIdleStatus(): SessionStatus {
    if (!this.session.enabled) return "disabled";
    if (!this.source) return "waitingForSubtitle";
    if (
      !this.effectiveTargetLanguage() ||
      (this.options.requiresProviderSelection && !this.options.profileId)
    )
      return "waitingForConfiguration";
    return "preparing";
  }

  tick(positionMs: number | null): void {
    this.session.updatePosition(positionMs);
    this.syncCurrentOverlay();
    if (!this.session.enabled || !this.source || positionMs === null || this.pipeline.inFlight)
      return;
    if (this.options.requiresProviderSelection && !this.options.profileId) {
      this.status = "waitingForConfiguration";
      return;
    }
    const targetLanguage = this.effectiveTargetLanguage();
    if (!targetLanguage) {
      this.status = "waitingForConfiguration";
      return;
    }
    const identity = this.cacheIdentity(targetLanguage);
    const window = selectNearbyCues(this.source.cues, positionMs);
    for (const cue of window) {
      const cached = this.cache.get(identity, cue.id);
      if (cached) this.translations.set(cue.id, cached);
    }
    const pending = window.filter(
      (cue) => !this.translations.has(cue.id) && !this.terminallyFailedCueIds.has(cue.id),
    );
    if (pending.length === 0) {
      if (this.translations.size > 0) this.status = "running";
      return;
    }
    const batch = batchCues(pending).batches[0] ?? [];
    if (batch.length === 0) {
      this.status = "partialFailure";
      return;
    }
    const fingerprint = this.session.fingerprint();
    const requestNumber = ++this.requestSequence;
    const frozenBatch = freezeTranslationTargets({ windowCues: window, targetCues: batch });
    this.status = "preparing";
    this.lastAttemptError = null;
    this.pipeline.run(async () => {
      let remaining = [...frozenBatch];
      let terminalError: ProviderAttemptError | null = null;
      for (let attempt = 0; attempt <= 3 && remaining.length > 0; attempt += 1) {
        if (!this.session.accepts(fingerprint) || this.source === null) return;
        const request = buildProviderRequest({
          fingerprint,
          requestId: `request-${requestNumber}-attempt-${attempt}`,
          batchId: `batch-${requestNumber}`,
          authorityId: this.options.authorityId ?? "injected-authority",
          activationGeneration: this.options.activationGeneration ?? 0,
          profileId: this.options.profileId ?? "injected-provider",
          profileRevision: this.options.profileRevision ?? 1,
          endpointFingerprint: this.options.endpointFingerprint ?? "injected",
          targetLanguage,
          targets: remaining,
        });
        this.activeAttempt = { batchId: request.batchId, requestId: request.requestId };
        try {
          const result = await this.attemptWithCancellation(request, (progress) => {
            if (!this.acceptsAttempt(request, fingerprint)) return;
            const accepted = this.acceptResults(remaining, progress, identity);
            if (accepted.size === 0) return;
            remaining = remaining.filter((cue) => !accepted.has(cue.id));
            this.syncCurrentOverlay(fingerprint);
            this.status = "running";
          });
          if (!this.session.accepts(fingerprint) || this.source === null) return;
          const accepted = this.acceptResults(remaining, result, identity);
          remaining = remaining.filter((cue) => !accepted.has(cue.id));
          if (accepted.size > 0) this.syncCurrentOverlay(fingerprint);
          terminalError = remaining.length
            ? {
                category: "protocol",
                retryable: true,
                providerCode: "PARTIAL_RESULT",
                userAction: "CHECK_ENDPOINT",
              }
            : null;
        } catch (error) {
          if (!this.session.accepts(fingerprint)) return;
          const detail =
            error && typeof error === "object" ? (error as Record<string, unknown>) : {};
          terminalError = classifyAttemptFailure({
            ...(typeof detail.category === "string"
              ? { category: detail.category as ProviderAttemptError["category"] }
              : {}),
            ...(typeof detail.statusCode === "number" ? { statusCode: detail.statusCode } : {}),
            ...(typeof detail.providerCode === "string"
              ? { providerCode: detail.providerCode }
              : {}),
            ...(typeof detail.retryAfterMs === "number"
              ? { retryAfterMs: detail.retryAfterMs }
              : {}),
          });
        } finally {
          if (
            this.activeAttempt?.batchId === request.batchId &&
            this.activeAttempt.requestId === request.requestId
          )
            this.activeAttempt = null;
        }
        if (remaining.length === 0 || !terminalError?.retryable || attempt === 3) break;
        const retryNumber = (attempt + 1) as 1 | 2 | 3;
        const current = await this.waitForRetry(
          retryDelayMs(retryNumber, this.options.random ?? Math.random, terminalError.retryAfterMs),
          fingerprint,
        );
        if (!current) return;
      }
      if (!this.session.accepts(fingerprint) || this.source === null) return;
      for (const cue of remaining) this.terminallyFailedCueIds.add(cue.id);
      this.lastAttemptError = remaining.length > 0 ? terminalError : null;
      if (this.session.accepts(fingerprint)) {
        if (remaining.length > 0)
          this.status = terminalError?.retryable ? "serviceUnavailable" : "partialFailure";
        else if (this.status !== "partialFailure") this.status = "running";
      }
    });
  }

  private acceptResults(
    requested: readonly FrozenTranslationTarget[],
    result: TranslationBatchResult | TranslationBatchProgress,
    identity: CacheIdentity,
  ): Set<string> {
    const requestedById = new Map(requested.map((cue) => [cue.id, cue]));
    const counts = new Map<string, number>();
    for (const item of result.translations) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    const seen = new Set<string>();
    const valid: Array<{ cueId: string; translation: string }> = [];
    for (const item of result.translations) {
      const text = item.text;
      const target = requestedById.get(item.id);
      if (!target || counts.get(item.id) !== 1 || !text.trim()) continue;
      seen.add(item.id);
      valid.push({ cueId: item.id, translation: text });
      this.translations.set(item.id, text);
      if (this.options.providerKind !== "claude" && this.options.providerKind !== "deepseek")
        try {
          const sourceIndex = this.source?.cues.findIndex((cue) => cue.id === target.id) ?? -1;
          const sourceCue = sourceIndex >= 0 ? this.source?.cues[sourceIndex] : undefined;
          const contextBefore =
            sourceIndex > 0 ? this.source?.cues[sourceIndex - 1]?.normalizedText : undefined;
          const contextAfter =
            sourceIndex >= 0 && sourceIndex + 1 < (this.source?.cues.length ?? 0)
              ? this.source?.cues[sourceIndex + 1]?.normalizedText
              : undefined;
          this.options.translationLog?.(
            formatTranslationComparison({
              source: sourceCue?.normalizedText ?? target.text,
              ...(contextBefore === undefined ? {} : { contextBefore }),
              ...(contextAfter === undefined ? {} : { contextAfter }),
              translation: text,
            }),
          );
        } catch (error) {
          void error;
        }
    }
    this.cache.insert(identity, valid);
    return seen;
  }

  private attemptWithCancellation(
    request: TranslationBatchRequest,
    onProgress: (progress: TranslationBatchProgress) => void,
  ): Promise<TranslationBatchResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const unregister = this.session.registerCancellation(() => {
        if (settled) return;
        settled = true;
        void this.options.provider.cancel?.(request.requestId);
        reject({ category: "cancelled", retryable: false });
      });
      this.options.provider
        .attempt(request, (progress) => {
          if (!settled) onProgress(progress);
        })
        .then(
          (result) => {
            if (settled) return;
            settled = true;
            unregister();
            resolve(result);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            unregister();
            reject(error);
          },
        );
    });
  }

  private waitForRetry(
    milliseconds: number,
    fingerprint: ReturnType<PlaybackSession["fingerprint"]>,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = hostTimers.setTimeout(() => {
        if (settled) return;
        settled = true;
        unregister();
        resolve(this.session.accepts(fingerprint));
      }, milliseconds);
      const unregister = this.session.registerCancellation(() => {
        if (settled) return;
        settled = true;
        timer.cancel();
        resolve(false);
      });
    });
  }

  private cacheIdentity(targetLanguage: string): CacheIdentity {
    return {
      sessionId: this.session.sessionId,
      sourceContentHash: this.source?.contentHash ?? "",
      targetLanguage,
      providerSemanticFingerprint: this.options.providerSemanticFingerprint ?? "injected",
    };
  }

  private effectiveTargetLanguage(): string | null {
    if (isTargetLanguageId(this.options.targetLanguage)) return this.options.targetLanguage;
    return this.options.requiresProviderSelection ? null : "en";
  }

  private acceptsAttempt(
    request: TranslationBatchRequest,
    fingerprint: ReturnType<PlaybackSession["fingerprint"]>,
  ): boolean {
    return (
      this.session.accepts(fingerprint) &&
      request.playerId === fingerprint.playerId &&
      request.sessionId === fingerprint.sessionId &&
      request.sessionEpoch === fingerprint.sessionEpoch &&
      request.windowEpoch === fingerprint.windowEpoch &&
      request.authorityId === (this.options.authorityId ?? "injected-authority") &&
      request.activationGeneration === (this.options.activationGeneration ?? 0) &&
      request.profileId === (this.options.profileId ?? "injected-provider") &&
      request.profileRevision === (this.options.profileRevision ?? 1) &&
      request.endpointFingerprint === (this.options.endpointFingerprint ?? "injected") &&
      this.activeAttempt?.batchId === request.batchId &&
      this.activeAttempt.requestId === request.requestId
    );
  }

  private syncCurrentOverlay(fingerprint?: ReturnType<PlaybackSession["fingerprint"]>): void {
    if (fingerprint && !this.session.accepts(fingerprint)) return;
    try {
      if (!this.session.enabled || !this.source) {
        this.options.overlay.clear();
        return;
      }
      const lines = selectActiveTranslations(
        this.source.cues,
        this.translations,
        this.session.positionMs,
      );
      if (lines.length > 0) this.options.overlay.show(lines);
      else this.options.overlay.clear();
    } catch (error) {
      void error;
    }
  }

  private clearOverlay(): void {
    try {
      this.options.overlay.clear();
    } catch (error) {
      void error;
    }
  }

  async whenIdle(): Promise<void> {
    await this.pipeline.whenIdle();
  }

  onSeek(positionMs: number | null): void {
    this.session.onSeek(positionMs);
    this.clearOverlay();
    this.status = this.nextIdleStatus();
  }

  endFile(): void {
    this.session.onFileChanged();
    this.source = null;
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = this.nextIdleStatus();
  }

  close(): void {
    this.session.close();
    this.translations.clear();
    this.terminallyFailedCueIds.clear();
    this.lastAttemptError = null;
    this.cache.clear();
    this.clearOverlay();
    this.status = "disabled";
  }
}
