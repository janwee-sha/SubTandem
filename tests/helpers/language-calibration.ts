import { francAll } from "franc";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectSubtitleLanguage,
  type LanguageDetectionParameters,
} from "../../src/subtitles/language-detection.js";
import { loadLanguageCorpus, corpusManifestHash } from "./language-corpus.js";
import { summarizeLanguageMetrics } from "./language-metrics.js";

export const CALIBRATION_SEARCH = Object.freeze({
  minimumLatinLetters: [45, 55, 65],
  minimumOtherLetters: [24, 30, 40],
  shortMargin: [0.0001, 0.001, 0.005, 0.015],
  longMargin: [0.0001, 0.001, 0.005],
  minimumScriptRatio: [0.8, 0.9],
  minimumSupport: [0.7, 0.8, 0.9],
  minimumModelCoverage: [0.15, 0.2, 0.25],
});
export const CALIBRATION_SELECTION =
  "minimum wrong-reliable rate; maximum correct-positive rate; fixed seven-parameter rule; highest lexicographic parameter vector on ties";
export function calibrateLanguageDetection() {
  const corpus = loadLanguageCorpus("calibration");
  const cache = new Map<string, Array<[string, number]>>();
  const classifier = (text: string): Array<[string, number]> => {
    const found = cache.get(text);
    if (found) return found;
    const result = francAll(text);
    cache.set(text, result);
    return result;
  };
  const candidates: LanguageDetectionParameters[] = [];
  for (const minimumLatinLetters of CALIBRATION_SEARCH.minimumLatinLetters)
    for (const minimumOtherLetters of CALIBRATION_SEARCH.minimumOtherLetters)
      for (const shortMargin of CALIBRATION_SEARCH.shortMargin)
        for (const longMargin of CALIBRATION_SEARCH.longMargin)
          for (const minimumScriptRatio of CALIBRATION_SEARCH.minimumScriptRatio)
            for (const minimumSupport of CALIBRATION_SEARCH.minimumSupport)
              for (const minimumModelCoverage of CALIBRATION_SEARCH.minimumModelCoverage)
                candidates.push({
                  minimumLatinLetters,
                  minimumOtherLetters,
                  shortMargin,
                  longMargin,
                  minimumScriptRatio,
                  minimumSupport,
                  minimumModelCoverage,
                });
  const results = candidates.map((parameters) => {
    const rows = corpus.tracks.map(({ record, cues }) => ({
      record,
      result: detectSubtitleLanguage(cues, { parameters, classifier }),
    }));
    const summary = summarizeLanguageMetrics(rows);
    return { parameters, summary };
  });
  results.sort(
    (left, right) =>
      left.summary.overall.wrongRate - right.summary.overall.wrongRate ||
      right.summary.overall.correctRate - left.summary.overall.correctRate ||
      Object.keys(CALIBRATION_SEARCH).reduce(
        (order, key) =>
          order ||
          right.parameters[key as keyof LanguageDetectionParameters] -
            left.parameters[key as keyof LanguageDetectionParameters],
        0,
      ),
  );
  const best = results[0]!;
  return {
    schemaVersion: 1,
    frozenRevision: corpus.manifest.frozenRevision,
    calibrationManifestHash: corpus.manifest.manifestHash,
    search: CALIBRATION_SEARCH,
    selection: CALIBRATION_SELECTION,
    candidateCount: candidates.length,
    parameters: best.parameters,
    summary: best.summary,
  };
}
export function writeLanguageCalibration(
  result: ReturnType<typeof calibrateLanguageDetection>,
): void {
  const detector = new URL("../../src/subtitles/language-detection.ts", import.meta.url);
  const algorithmSha256 = createHash("sha256").update(readFileSync(detector)).digest("hex");
  const record = { ...result, algorithmSha256 };
  writeFileSync(
    fileURLToPath(new URL("../fixtures/languages/calibration-result.json", import.meta.url)),
    JSON.stringify({ ...record, manifestHash: corpusManifestHash(record) }, null, 2) + "\n",
  );
}
