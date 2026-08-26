import { describe, expect, it, vi } from "vitest";
import {
  batchCues,
  needsRefill,
  selectNearbyCues,
  StableSeekGate,
} from "../../src/app/scheduler.js";
import { FakeClock } from "../helpers/fake-clock.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

const cues = Array.from({ length: 100 }, (_, index): SubtitleCue => ({
  id: `c${index}`,
  index,
  startMs: index * 5_000,
  endMs: index * 5_000 + 2_000,
  sourceText: `cue ${index}`,
  normalizedText: `cue ${index}`,
}));

describe("bounded scheduler", () => {
  it("uses the first reached 120-second or 40-cue boundary", () => {
    expect(selectNearbyCues(cues, 0)).toHaveLength(25);
    const dense = cues.map((cue, index) => ({
      ...cue,
      startMs: index * 1_000,
      endMs: index * 1_000 + 500,
    }));
    expect(selectNearbyCues(dense, 0)).toHaveLength(40);
    expect(selectNearbyCues(dense, 0).at(-1)?.startMs).toBe(39_000);
  });

  it("refills below either 30 seconds or 10 remaining cues and pauses when not needed", () => {
    expect(needsRefill(cues.slice(0, 20), new Set(cues.slice(0, 12).map((cue) => cue.id)), 0)).toBe(
      true,
    );
    expect(needsRefill(cues.slice(0, 20), new Set(cues.slice(0, 5).map((cue) => cue.id)), 0)).toBe(
      false,
    );
    expect(needsRefill(cues.slice(0, 20), new Set(), 0, true)).toBe(false);
  });

  it("splits at 25 cues and 5,000 Unicode code points without breaking surrogate pairs", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...cues[index]!,
      normalizedText: "👩🏽‍💻".repeat(100),
    }));
    const { batches, oversized } = batchCues(many);
    expect(oversized).toEqual([]);
    expect(batches.flat()).toHaveLength(30);
    expect(
      batches.every(
        (batch) =>
          batch.length <= 25 &&
          batch.reduce((sum, cue) => sum + [...cue.normalizedText].length, 0) <= 5_000,
      ),
    ).toBe(true);
    expect(batchCues([{ ...cues[0]!, normalizedText: "x".repeat(5_001) }]).oversized).toHaveLength(
      1,
    );
  });

  it("debounces rapid seeks and serves only the final stable position", () => {
    const clock = new FakeClock();
    const stable = vi.fn();
    const gate = new StableSeekGate(clock, 300, stable);
    gate.seek(1_000);
    clock.advanceBy(100);
    gate.seek(20_000);
    clock.advanceBy(299);
    expect(stable).not.toHaveBeenCalled();
    clock.advanceBy(1);
    expect(stable).toHaveBeenCalledExactlyOnceWith(20_000);
  });
});
