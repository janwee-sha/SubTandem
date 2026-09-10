import { describe, expect, it } from "vitest";
import {
  detectSubtitleLanguage,
  sampleSubtitleCues,
} from "../../src/subtitles/language-detection.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

function cue(index: number, text: string): SubtitleCue {
  return {
    id: `cue-${index}`,
    index,
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    sourceText: text,
    normalizedText: text,
  };
}

function corpus(prefix = "natural subtitle sentence"): SubtitleCue[] {
  return Array.from({ length: 80 }, (_, index) => cue(index, `${prefix} ${index} ${prefix}`));
}

describe("subtitle language sampling", () => {
  it("samples four deterministic quartiles with fixed cue and text budgets", () => {
    const sample = sampleSubtitleCues(corpus());
    expect(sample.windows).toHaveLength(4);
    expect(sample.windows.map((window) => window.cues.length)).toEqual([16, 16, 16, 16]);
    expect(sample.cues).toHaveLength(64);
    expect(Array.from(sample.text).length).toBeLessThanOrEqual(4_000);
    expect(sample.windows[0]!.cues[0]!.index).toBe(0);
    expect(sample.windows[3]!.cues[0]!.index).toBe(60);
  });

  it("filters blank, numeric, punctuation, URL and exact duplicate lines", () => {
    const noise = ["", "12345", "...?!", "https://example.test/path", "same line", "same line"];
    const sample = sampleSubtitleCues([
      ...noise.map((text, index) => cue(index, text)),
      ...corpus().map((item, index) => ({ ...item, index: index + noise.length })),
    ]);
    expect(sample.cues.some((item) => noise.includes(item.normalizedText))).toBe(false);
  });

  it("requires at least twelve cues and two hundred letters", () => {
    expect(detectSubtitleLanguage(corpus().slice(0, 11))).toEqual({ state: "unknown" });
    expect(
      detectSubtitleLanguage(Array.from({ length: 12 }, (_, index) => cue(index, `word ${index}`))),
    ).toEqual({ state: "unknown" });
  });

  it("accepts only consistent windows, eighty percent support and a 0.12 margin", () => {
    const inputs: string[] = [];
    const reliable = detectSubtitleLanguage(corpus(), {
      classifier: (text) => {
        inputs.push(text);
        return [
          ["eng", 1],
          ["deu", 0.7],
        ];
      },
    });
    expect(reliable).toEqual({ state: "reliable", languageId: "en" });
    expect(inputs).toHaveLength(5);
    expect(
      detectSubtitleLanguage(corpus(), {
        classifier: () => [
          ["eng", 1],
          ["deu", 0.998],
        ],
      }),
    ).toEqual({ state: "unknown" });
  });
});

describe("subtitle language failure closing", () => {
  it("distinguishes unsupported script from unknown input", () => {
    const armenian = corpus(
      "Այս բնական ենթագրի նախադասությունը բավական երկար է լեզուն որոշելու համար",
    );
    expect(detectSubtitleLanguage(armenian)).toEqual({ state: "unsupported" });
    expect(detectSubtitleLanguage(corpus("12345 -- ..."))).toEqual({ state: "unknown" });
  });

  it("keeps ambiguous Han conservative and distinguishes strong variants", () => {
    const ambiguous = corpus("今天我们一起回家吃饭然后看看天气是否适合出门散步");
    const simplified = corpus("头发里面还有软件网络后台发展这些简体证据");
    const traditional = corpus("頭髮裡面還有軟體網路後臺發展這些繁體證據");
    expect(detectSubtitleLanguage(ambiguous)).toEqual({ state: "reliable", languageId: "zh" });
    expect(detectSubtitleLanguage(simplified)).toEqual({
      state: "reliable",
      languageId: "zh-Hans",
    });
    expect(detectSubtitleLanguage(traditional)).toEqual({
      state: "reliable",
      languageId: "zh-Hant",
    });
  });

  it("rejects mixed window leaders and closes classifier exceptions", () => {
    let call = 0;
    expect(
      detectSubtitleLanguage(corpus(), {
        classifier: () => (call++ % 2 === 0 ? [["eng", 1]] : [["deu", 1]]),
      }),
    ).toEqual({ state: "unknown" });
    expect(
      detectSubtitleLanguage(corpus(), {
        classifier: () => {
          throw new Error("private classifier detail");
        },
      }),
    ).toEqual({ state: "unknown" });
  });
});
