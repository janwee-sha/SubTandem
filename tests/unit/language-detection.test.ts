import { describe, expect, it } from "vitest";
import { data } from "franc-all/data.js";
import { expressions } from "franc-all/expressions.js";
import { SOURCE_LANGUAGES, getSourceLanguage } from "../../src/domain/source-languages.js";
import {
  detectSubtitleLanguage,
  createLanguageDetectionWork,
  DEFAULT_DETECTION_PARAMETERS,
} from "../../src/subtitles/language-detection.js";
import { loadFrozenCorpora } from "../helpers/language-corpus.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

describe("fixed source language boundary", () => {
  it("maps exactly the 67 source identities to available model codes", () => {
    expect(SOURCE_LANGUAGES.map((language) => language.languageId)).toEqual(
      "am ar az be bg bho bn bs ceb cs de el en es fa fil fr gu ha hi hmn hr hu id ig it ja jv kk kn ko ku ln mg ml mr ms my ne nl ny pa pl ps pt qu rn ro ru rw si so sr su sv sw ta te th tr uk ur uz vi yo zh zu".split(
        " ",
      ),
    );
    const codes = new Set([
      ...Object.keys(expressions),
      ...Object.values(data).flatMap(Object.keys),
    ]);
    expect(new Set(SOURCE_LANGUAGES.map((language) => language.detectorCode)).size).toBe(67);
    for (const language of SOURCE_LANGUAGES) expect(codes.has(language.detectorCode)).toBe(true);
    expect(getSourceLanguage("cmn")?.languageId).toBe("zh");
    expect(getSourceLanguage("por")?.languageId).toBe("pt");
    for (const code of ["fin", "nob", "nno", "heb", "ina"]) {
      expect(codes.has(code)).toBe(true);
      expect(getSourceLanguage(code)).toBeNull();
    }
  });
});

function cue(index: number, text: string): SubtitleCue {
  return {
    id: String(index),
    index,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    sourceText: text,
    normalizedText: text,
  };
}
const calibration = loadFrozenCorpora().calibration;
function natural(id: string) {
  return calibration.samples.find((s) => s.sampleId === `calibration-${id}`)!;
}

describe("natural short subtitle regressions", () => {
  it.each([
    "de-eleven",
    "en-ass",
    "hu-19",
    "it-19",
    "ru-19",
    "sv-19",
    "en-6",
    "de-6",
    "ja-6",
    "ar-6",
    "ko-6",
    "ha-6",
  ])("uses the body of %s", (id) => {
    const sample = natural(id);
    expect(detectSubtitleLanguage(sample.cues)).toEqual({
      state: "reliable",
      languageId: sample.truth.expectedLanguageIds[0],
    });
  });
  it("preserves translation eligibility across the eleven/twelve cue boundary", () => {
    const result = detectSubtitleLanguage(natural("de-eleven").cues);
    expect(result).toEqual({ state: "reliable", languageId: "de" });
    for (const id of ["de-twelve", "de-duration", "de-inside-word"])
      expect(detectSubtitleLanguage(natural(id).cues)).toEqual(result);
  });
});

describe("bounded body candidate work", () => {
  it("classifies the entire body when whitespace fills the UTF-16 input budget", () => {
    const seen: string[] = [];
    detectSubtitleLanguage([cue(0, `${"a ".repeat(511)}Z`)], {
      parameters: { ...DEFAULT_DETECTION_PARAMETERS, spanLetterBudget: 512, contextLimit: 512 },
      classifier: (text) => {
        seen.push(text);
        return [["eng", 1]];
      },
    });
    expect(seen.some((text) => text.includes("Z"))).toBe(true);
  });

  it("ends every classifier input on a complete Unicode code point", () => {
    const seen: string[] = [];
    const result = detectSubtitleLanguage([cue(0, `A${"𐐀".repeat(2000)}`)], {
      parameters: { ...DEFAULT_DETECTION_PARAMETERS, spanLetterBudget: 512, contextLimit: 512 },
      classifier: (text) => {
        seen.push(text);
        return [["eng", 1]];
      },
    });
    expect(result.state).toBe("reliable");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((text) => !/[\uD800-\uDBFF]$/.test(text))).toBe(true);
  });

  it("does not reject low-margin, short or locally inconsistent candidates", () => {
    expect(
      detectSubtitleLanguage([cue(0, "Hello")], {
        classifier: () => [
          ["eng", 1],
          ["deu", 0.99999],
        ],
      }),
    ).toEqual({ state: "reliable", languageId: "en" });
    let call = 0;
    expect(
      detectSubtitleLanguage([cue(0, "meaningful words ".repeat(80))], {
        classifier: () => [[call++ % 2 ? "deu" : "eng", 1]],
      }).state,
    ).toBe("reliable");
  });
  it("keeps repeated occurrences and ignores timestamps and metadata for weighting", () => {
    const text = "Repeated spoken words are still part of the subtitle.";
    const cues = Array.from({ length: 20 }, (_, i) => cue(i, text));
    const seen: string[] = [];
    const result = detectSubtitleLanguage(cues, {
      classifier: (t) => {
        seen.push(t);
        return [["eng", 1]];
      },
    });
    expect(result).toEqual({ state: "reliable", languageId: "en" });
    expect(seen.join(" ").split("Repeated").length).toBeGreaterThan(2);
    expect(
      detectSubtitleLanguage(
        cues.map((c, i) => ({ ...c, startMs: 100000 - i, endMs: 200000 - i })),
      ),
    ).toEqual(detectSubtitleLanguage(cues));
  });
  it("strips complete URLs and formatting, normalizes NFC, and counts only language text", () => {
    const inputs: string[] = [];
    expect(
      detectSubtitleLanguage(
        [cue(0, "<i>Cafe\u0301</i> {\\i1} https://example.com/English www.test.org/German")],
        {
          classifier: (t) => {
            inputs.push(t);
            return [["fra", 1]];
          },
        },
      ),
    ).toEqual({ state: "reliable", languageId: "fr" });
    expect(
      inputs.every(
        (t) =>
          t.includes("Café") &&
          !t.includes("http") &&
          !t.includes("English") &&
          !t.includes("German") &&
          !t.includes("i1"),
      ),
    ).toBe(true);
    expect(detectSubtitleLanguage([cue(0, "123 !? https://example.test/test")])).toEqual({
      state: "unknown",
    });
  });
  it("performs scanning and classification inside resumable steps and bounds model inputs", () => {
    const calls: string[] = [];
    const work = createLanguageDetectionWork(
      [cue(0, "The words on this page describe an ordinary day. ".repeat(1000))],
      {
        classifier: (t, options) => {
          expect(options.minLength).toBe(0);
          expect(t.length).toBeLessThanOrEqual(2048);
          calls.push(t);
          return [["eng", 1]];
        },
      },
    );
    expect(calls).toHaveLength(0);
    const phases: string[] = [];
    let step = work.next();
    expect(step.done).toBe(false);
    expect(calls).toHaveLength(0);
    while (!step.done) {
      phases.push(step.value.phase);
      step = work.next();
    }
    expect(step.value).toEqual({ state: "reliable", languageId: "en" });
    expect(new Set(phases)).toEqual(new Set(["scan", "sample", "classify", "aggregate"]));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(64 * 3 + 1);
    work.dispose();
  });
  it("releases pending work on cancellation and closes classifier exceptions", () => {
    let calls = 0;
    const work = createLanguageDetectionWork([cue(0, "some words")], {
      classifier: () => {
        calls++;
        throw Error("private");
      },
    });
    work.next();
    work.dispose();
    expect(work.next().done).toBe(true);
    expect(calls).toBe(0);
    expect(
      detectSubtitleLanguage([cue(0, "some words")], {
        classifier: () => {
          throw Error("private");
        },
      }),
    ).toEqual({ state: "unknown" });
    expect(detectSubtitleLanguage([cue(0, "some words")], { classifier: () => [] })).toEqual({
      state: "unknown",
    });
    expect(DEFAULT_DETECTION_PARAMETERS.minLength).toBe(0);
  });
});

describe("mixed and unsupported body regressions", () => {
  it.each(
    calibration.samples
      .filter((sample) => sample.kind === "controlled-mix")
      .map((sample) => [sample.sampleId, sample] as const),
  )("assigns %s by supported letter weight", (_id, sample) => {
    const result = detectSubtitleLanguage(sample.cues);
    if (sample.truth.behavior === "unsupported") expect(result).toEqual({ state: "unsupported" });
    else {
      expect(result.state).toBe("reliable");
      if (result.state === "reliable")
        expect(sample.truth.expectedLanguageIds).toContain(result.languageId);
    }
  });
  it.each(["unsupported-fi", "unsupported-he", "unsupported-no", "unsupported-ia"])(
    "recognizes only-outside %s",
    (id) => {
      expect(detectSubtitleLanguage(natural(id).cues)).toEqual({ state: "unsupported" });
    },
  );
  it.each(["romanized-only", "sparse"])("keeps a candidate for ambiguous %s", (id) => {
    expect(detectSubtitleLanguage(natural(id).cues).state).toBe("reliable");
  });
  it.each(["zh-unspecified", "zh-conflicting", "zh-with-kana", "zh-hant-translation"])(
    "uses only attributable Chinese form evidence in %s",
    (id) => {
      const sample = natural(id);
      expect(detectSubtitleLanguage(sample.cues)).toEqual({
        state: "reliable",
        languageId: sample.truth.expectedLanguageIds[0],
      });
    },
  );
});
