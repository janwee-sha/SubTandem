import { describe, expect, it } from "vitest";
import {
  createLanguageDetectionWork,
  detectSubtitleLanguage,
  sampleSubtitleCues,
} from "../../src/subtitles/language-detection.js";
import { parseAss } from "../../src/subtitles/ass.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { loadLanguageCorpus } from "../helpers/language-corpus.js";

const calibration = loadLanguageCorpus("calibration").tracks;
const english = calibration.find((sample) => sample.record.languageTruth.languageId === "en")!.cues;
function cue(index: number, text: string): SubtitleCue {
  return {
    id: `cue-${index}`,
    index,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    sourceText: text,
    normalizedText: text,
  };
}
function large(count = 200): SubtitleCue[] {
  return Array.from({ length: count }, (_, index) =>
    cue(index, `${english[index % english.length]!.normalizedText} ${index}`),
  );
}

describe("subtitle language sampling", () => {
  it("retains all useful short-track evidence and deduplicates a repeated cue only once", () => {
    const sample = sampleSubtitleCues([
      ...english,
      english[0]!,
      cue(100, "12345"),
      cue(101, "https://example.test/a"),
      cue(102, "...?!"),
    ]);
    expect(sample.cues.length).toBe(english.length);
    expect(english.every((item) => sample.text.includes(item.normalizedText))).toBe(true);
    expect(detectSubtitleLanguage(english)).toMatchObject({ state: "reliable", languageId: "en" });
    expect(
      detectSubtitleLanguage([cue(0, english.map((item) => item.normalizedText).join("\n"))]),
    ).toMatchObject({ state: "reliable", languageId: "en" });
  });
  it("covers four timeline regions within 64 cue and 4096 UTF-16 unit budgets", () => {
    const input = large();
    const sample = sampleSubtitleCues(input);
    expect(sample.windows).toHaveLength(4);
    expect(sample.cues.length).toBeLessThanOrEqual(64);
    expect(sample.text.length).toBeLessThanOrEqual(4096);
    expect(
      sample.windows.every((window, index) =>
        window.cues.some((item) => item.index >= index * 50 && item.index < (index + 1) * 50),
      ),
    ).toBe(true);
  });
  it("limits every actual classifier call and preserves surrogate pairs at sample and fragment boundaries", () => {
    const inputs: string[] = [];
    const sample = sampleSubtitleCues(
      large(64).map((item) => cue(item.index, `${item.normalizedText} ${"𠀀".repeat(100)}`)),
    );
    detectSubtitleLanguage(sample.cues, {
      classifier: (text) => {
        inputs.push(text);
        return [
          ["eng", 1],
          ["deu", 0.5],
        ];
      },
    });
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.length).toBeLessThanOrEqual(4);
    expect(inputs.every((text) => text.length <= 2048 && text.isWellFormed())).toBe(true);
    expect(sample.text.length <= 4096 && sample.text.isWellFormed()).toBe(true);
  });
  it("performs bounded real work and splits oversized cue preprocessing", () => {
    const input = Array.from({ length: 20_000 }, (_, index) => cue(index, "1234"));
    input[0] = cue(0, "x".repeat(100_000));
    const work = createLanguageDetectionWork(input);
    let steps = 0;
    let sampling = 0;
    for (let step = work.next(); !step.done; step = work.next()) {
      steps++;
      if (step.value.phase === "sampling") sampling++;
      expect(step.value.processedCues).toBeLessThanOrEqual(128);
      expect(step.value.processedCodeUnits).toBeLessThanOrEqual(16_384);
    }
    expect(sampling).toBeGreaterThan(1);
    expect(steps).toBeLessThan(1000);
  });
  it("uses production ASS body preparation while keeping styling out of classification", () => {
    const body = english
      .map(
        (item, index) =>
          `Dialogue: 0,0:00:${String(index).padStart(2, "0")}.00,0:00:${String(index).padStart(2, "0")}.90,Default,,0,0,0,,{\\i1}${item.sourceText.replaceAll("\n", "\\N")}`,
      )
      .join("\n");
    const parsed = parseAss(
      `[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${body}`,
    );
    expect(parsed.warnings.length).toBe(0);
    expect(detectSubtitleLanguage(parsed.cues)).toEqual(detectSubtitleLanguage(english));
  });
});

describe("language reliability", () => {
  it("keeps insufficient numeric, link, proper-name, lyric and romanization evidence unknown", () => {
    const negatives = calibration.filter(
      (sample) => sample.record.languageTruth.kind === "negative",
    );
    expect(negatives.length).toBeGreaterThan(0);
    for (const sample of negatives)
      expect(detectSubtitleLanguage(sample.cues).state, sample.record.sampleId).toBe("unknown");
  });
  it("preserves full model competition and unmapped winners", () => {
    expect(
      detectSubtitleLanguage(english, {
        classifier: () => [
          ["sco", 1],
          ["eng", 0.5],
        ],
      }),
    ).toEqual({ state: "unknown", reason: "unmapped" });
    expect(
      detectSubtitleLanguage(english, {
        classifier: () => [
          ["eng", 1],
          ["sco", 0.9999],
        ],
      }),
    ).toEqual({ state: "unknown", reason: "ambiguous" });
    expect(detectSubtitleLanguage(english, { classifier: () => [["und", 1]] })).toEqual({
      state: "unknown",
      reason: "unsupported",
    });
    expect(detectSubtitleLanguage(english, { classifier: () => [["eng", 1]] })).toEqual({
      state: "unknown",
      reason: "ambiguous",
    });
  });
  it("does not infer Chinese scripts or Portuguese regions", () => {
    for (const language of ["zh", "pt"]) {
      const sample = calibration.find(
        (sample) => sample.record.languageTruth.languageId === language,
      )!;
      expect(detectSubtitleLanguage(sample.cues)).toMatchObject({
        state: "reliable",
        languageId: language,
      });
    }
  });
  it("does not accept a lone script label from score one alone", () => {
    expect(
      detectSubtitleLanguage([cue(0, "文".repeat(200))], { classifier: () => [["cmn", 1]] }).state,
    ).toBe("unknown");
    expect(detectSubtitleLanguage(english, { classifier: () => [["cmn", 1]] }).state).toBe(
      "unknown",
    );
  });
  it("rejects conflicting fragments and sanitizes synchronous classifier failures", () => {
    let call = 0;
    expect(
      detectSubtitleLanguage(
        large(64).map((item) => cue(item.index, `${item.normalizedText} ${item.normalizedText}`)),
        {
          classifier: () =>
            call++ % 2 === 0
              ? [
                  ["eng", 1],
                  ["deu", 0.5],
                ]
              : [
                  ["deu", 1],
                  ["eng", 0.5],
                ],
        },
      ).state,
    ).toBe("unknown");
    expect(
      detectSubtitleLanguage(english, {
        classifier: () => {
          throw new Error("private detail");
        },
      }),
    ).toEqual({ state: "unknown", reason: "error" });
  });
});

it.skipIf(process.env.SUBTANDEM_LANGUAGE_CALIBRATION !== "1")(
  "calibration freezes parameters using only the independent calibration corpus",
  async () => {
    const { calibrateLanguageDetection, writeLanguageCalibration } =
      await import("../helpers/language-calibration.js");
    const result = calibrateLanguageDetection();
    writeLanguageCalibration(result);
    console.info("language-calibration", JSON.stringify(result));
    expect(result.candidateCount).toBe(1944);
  },
  120_000,
);
