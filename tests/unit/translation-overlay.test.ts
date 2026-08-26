import { describe, expect, it } from "vitest";
import { selectActiveTranslations } from "../../src/subtitles/active-translations.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

function cue(id: string, index: number, startMs: number, endMs: number): SubtitleCue {
  return {
    id,
    index,
    startMs,
    endMs,
    sourceText: id,
    normalizedText: id,
  };
}

describe("active translations", () => {
  const cues = [
    cue("overlap-first", 3, 500, 1_500),
    cue("overlap-second", 1, 750, 1_500),
    cue("zero", 2, 1_000, 1_000),
    cue("future", 4, 2_000, 3_000),
  ];
  const translations = new Map([
    ["overlap-first", "first"],
    ["overlap-second", "second\nline"],
    ["zero", "zero"],
    ["future", "future"],
  ]);

  it("uses half-open cue ranges and preserves source cue order", () => {
    expect(selectActiveTranslations(cues, translations, 750)).toEqual(["first", "second\nline"]);
    expect(selectActiveTranslations(cues, translations, 1_500)).toEqual([]);
    expect(selectActiveTranslations(cues, translations, 2_000)).toEqual(["future"]);
  });

  it("ignores zero-duration, future, expired, missing and empty translations", () => {
    const values = new Map(translations);
    values.set("overlap-first", " \r\n ");
    values.delete("overlap-second");

    expect(selectActiveTranslations(cues, values, null)).toEqual([]);
    expect(selectActiveTranslations(cues, values, 1_000)).toEqual([]);
  });
});
