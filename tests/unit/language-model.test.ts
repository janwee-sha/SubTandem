import { describe, expect, it } from "vitest";
import { francAll } from "franc-all";
import { queryLanguageModel } from "../../src/subtitles/language-model.js";
import { SOURCE_DETECTOR_CODES } from "../../src/domain/source-languages.js";
import { loadFrozenCorpora } from "../helpers/language-corpus.js";

describe("indexed offline model", () => {
  it("preserves every score, candidate and tie order from the pinned model for calibration and Unicode boundaries", () => {
    const samples = loadFrozenCorpora().calibration.samples.map((sample) =>
      sample.cues.map((cue) => cue.normalizedText).join(" "),
    );
    samples.push(
      "",
      "123!?",
      "a",
      "Hello",
      "the Ko",
      "𐐀𐐁𐐂",
      "e\u0301",
      "日本語한국어汉字",
      "Հայերեն ქართული עברית",
      "aaaaaaaaaaaaa",
      " _-_ \t\r\n",
    );
    for (const body of samples)
      for (const size of [64, 512, 2048]) {
        const text = body.slice(0, size);
        for (const options of [
          { minLength: 0 as const },
          { minLength: 0 as const, only: SOURCE_DETECTOR_CODES },
        ])
          expect(queryLanguageModel(text, options)).toEqual(francAll(text, options));
      }
  });
});
