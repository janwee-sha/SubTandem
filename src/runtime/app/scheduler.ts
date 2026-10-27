import type { SubtitleCue } from "../subtitles/types.js";

export interface CueWindowOptions {
  lookaheadMs?: number;
  maxCues?: number;
}

export function selectNearbyCues(
  cues: readonly SubtitleCue[],
  positionMs: number,
  options: CueWindowOptions = {},
): SubtitleCue[] {
  const lookaheadMs = options.lookaheadMs ?? 120_000;
  const maxCues = options.maxCues ?? 40;
  return cues
    .filter((cue) => cue.endMs >= positionMs && cue.startMs <= positionMs + lookaheadMs)
    .slice(0, maxCues);
}

export function needsRefill(
  window: readonly SubtitleCue[],
  completedIds: ReadonlySet<string>,
  positionMs: number,
  paused = false,
): boolean {
  if (paused) return false;
  const remaining = window.filter((cue) => !completedIds.has(cue.id) && cue.endMs >= positionMs);
  if (remaining.length === 0) return true;
  const finalEnd = remaining[remaining.length - 1]?.endMs ?? positionMs;
  return remaining.length < 10 || finalEnd - positionMs < 30_000;
}

export function batchCues(
  cues: readonly SubtitleCue[],
  maxCues = 25,
  maxCodePoints = 5_000,
): { batches: SubtitleCue[][]; oversized: SubtitleCue[] } {
  const batches: SubtitleCue[][] = [];
  const oversized: SubtitleCue[] = [];
  let current: SubtitleCue[] = [];
  let codePoints = 0;
  const flush = (): void => {
    if (current.length) batches.push(current);
    current = [];
    codePoints = 0;
  };
  for (const cue of cues) {
    const length = [...cue.normalizedText].length;
    if (length > maxCodePoints) {
      flush();
      oversized.push(cue);
      continue;
    }
    if (current.length >= maxCues || codePoints + length > maxCodePoints) flush();
    current.push(cue);
    codePoints += length;
  }
  flush();
  return { batches, oversized };
}

export interface SchedulerClock {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export class StableSeekGate {
  private timer: number | null = null;

  constructor(
    private readonly clock: SchedulerClock,
    private readonly debounceMs: number,
    private readonly onStable: (positionMs: number) => void,
  ) {}

  seek(positionMs: number): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.onStable(positionMs);
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
