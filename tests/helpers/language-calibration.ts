import { francAll } from "franc";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectSubtitleLanguage,
  LANGUAGE_CANDIDATE_MINIMUM_MODEL_DENSITY,
  LANGUAGE_CANDIDATE_SCORE_BIASES,
  LANGUAGE_DETECTION_PARAMETERS,
  LANGUAGE_LEXICAL_EVIDENCE,
  LANGUAGE_SHARED_MODEL_EVIDENCE,
  type LanguageDetectionParameters,
} from "../../src/subtitles/language-detection.js";
import {
  loadCorpusVersionIndex,
  loadVersionedLanguageCorpus,
  corpusManifestHash,
  validateCorpusPurpose,
  loadMixedLanguageCases,
} from "./language-corpus.js";
import { summarizeLanguageMetrics } from "./language-metrics.js";

export const CALIBRATION_SEARCH = Object.freeze({
  minimumLatinLetters: [65],
  minimumOtherLetters: [18],
  shortMargin: [0.001, 0.005, 0.02, 0.04],
  longMargin: [0.0001, 0.001],
  minimumSegmentLetters: [3, 5],
  minimumModelCoverage: [0.2, 0.3, 0.4],
  contextWeight: [0.95, 1],
  independentEvidence: [3, 6],
  modelEvidenceWeight: [0.2],
});
export const CALIBRATION_SELECTION =
  "First require overall wrong-reliable <=1%, negative-reliable <=1%, and all prelabelled semantics; then minimize maximum per-work wrong rate, maximize macro per-work and overall correct rate, prefer the highest fixed parameter vector. If infeasible, report failure and the candidate with minimum constraint excess; never relax the gates.";
export function calibrateLanguageDetection() {
  validateCorpusPurpose(loadCorpusVersionIndex(), "holdout");
  const corpus = loadVersionedLanguageCorpus("calibration");
  const mixed = loadMixedLanguageCases();
  const cache = new Map<string, Array<[string, number]>>();
  const classifier = (text: string): Array<[string, number]> => {
    const found = cache.get(text);
    if (found) return found;
    const result = francAll(text, { minLength: 1 });
    cache.set(text, result);
    return result;
  };
  const candidates: LanguageDetectionParameters[] = [];
  for (const minimumLatinLetters of CALIBRATION_SEARCH.minimumLatinLetters)
    for (const minimumOtherLetters of CALIBRATION_SEARCH.minimumOtherLetters)
      for (const shortMargin of CALIBRATION_SEARCH.shortMargin)
        for (const longMargin of CALIBRATION_SEARCH.longMargin)
          for (const minimumSegmentLetters of CALIBRATION_SEARCH.minimumSegmentLetters)
            for (const minimumModelCoverage of CALIBRATION_SEARCH.minimumModelCoverage)
              for (const contextWeight of CALIBRATION_SEARCH.contextWeight)
                for (const independentEvidence of CALIBRATION_SEARCH.independentEvidence)
                  for (const modelEvidenceWeight of CALIBRATION_SEARCH.modelEvidenceWeight)
                    candidates.push({
                      minimumLatinLetters,
                      minimumOtherLetters,
                      shortMargin,
                      longMargin,
                      minimumSegmentLetters,
                      contextWeight,
                      minimumModelCoverage,
                      independentEvidence,
                      modelEvidenceWeight,
                    });
  const results = candidates.map((parameters) => {
    const rows = corpus.tracks.map(({ record, cues }) => ({
      record,
      result: detectSubtitleLanguage(cues, { parameters, classifier }),
    }));
    const summary = summarizeLanguageMetrics(rows);
    const workGroups = [
      ...new Set(
        rows
          .filter(({ record }) => record.languageTruth.kind === "positive")
          .map(({ record }) => record.sourceGroupId),
      ),
    ].sort();
    const byWork = Object.fromEntries(
      workGroups.map((work) => [
        work,
        summarizeLanguageMetrics(rows.filter(({ record }) => record.sourceGroupId === work))
          .overall,
      ]),
    );
    const mixedFailures = mixed.cases.filter(({ record, cues }) => {
      const result = detectSubtitleLanguage(cues, { parameters, classifier });
      return (
        result.state !== record.expected.state ||
        (result.state === "reliable" &&
          record.expected.state === "reliable" &&
          result.languageId !== record.expected.languageId)
      );
    }).length;
    const constraintExcess =
      Math.max(0, summary.overall.wrongRate - 0.01) +
      Math.max(0, summary.overall.negativeReliableRate - 0.01) +
      mixedFailures / mixed.cases.length;
    const maximumWorkWrong = Math.max(...Object.values(byWork).map((work) => work.wrongRate));
    const macroWorkCorrect =
      Object.values(byWork).reduce((sum, work) => sum + work.correctRate, 0) / workGroups.length;
    return {
      parameters,
      summary,
      byWork,
      mixedFailures,
      constraintExcess,
      maximumWorkWrong,
      macroWorkCorrect,
    };
  });
  results.sort(
    (left, right) =>
      left.constraintExcess - right.constraintExcess ||
      left.maximumWorkWrong - right.maximumWorkWrong ||
      right.macroWorkCorrect - left.macroWorkCorrect ||
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
  const activeSummary = summarizeLanguageMetrics(
    corpus.tracks.map(({ record, cues }) => ({
      record,
      result: detectSubtitleLanguage(cues, { classifier }),
    })),
  );
  return {
    schemaVersion: 2,
    status: results.some((row) => row.constraintExcess === 0)
      ? "candidate-selected"
      : "failed-search",
    frozenRevision: corpus.manifest.frozenRevision,
    calibrationManifestHash: corpus.manifest.manifestHash,
    mixedManifestHash: mixed.manifest.manifestHash,
    search: CALIBRATION_SEARCH,
    selection: CALIBRATION_SELECTION,
    candidateCount: candidates.length,
    feasibleCandidateCount: results.filter((row) => row.constraintExcess === 0).length,
    parameters: best.parameters,
    summary: best.summary,
    byWork: best.byWork,
    mixedFailures: best.mixedFailures,
    constraintExcess: best.constraintExcess,
    activeParameters: LANGUAGE_DETECTION_PARAMETERS,
    activeSummary,
    rules: {
      wholeWorks: Object.keys(best.byWork),
      segmentLetters: CALIBRATION_SEARCH.minimumSegmentLetters,
      naturalLongInputs: corpus.tracks.filter(
        ({ cues }) => cues.map((cue) => cue.normalizedText).join("\n").length > 2048,
      ).length,
      sufficientlyLongNegatives: corpus.tracks.filter(
        ({ record }) => record.languageTruth.kind === "negative" && record.letterCount >= 65,
      ).length,
      completeCompetition: "franc@6.2.0; no only/ignore filters",
      modelEvidence:
        "Distinct Unicode-normalized model trigrams weighted by inverse model frequency and franc rank",
      candidateScoreBiases: LANGUAGE_CANDIDATE_SCORE_BIASES,
      candidateMinimumModelDensity: LANGUAGE_CANDIDATE_MINIMUM_MODEL_DENSITY,
      sharedModelEvidence: LANGUAGE_SHARED_MODEL_EVIDENCE,
      lexicalEvidence: LANGUAGE_LEXICAL_EVIDENCE,
      mixedCases: mixed.cases.length,
    },
    candidates: results.map((result) => ({
      parameters: result.parameters,
      ...result.summary.overall,
      mixedFailures: result.mixedFailures,
    })),
  };
}
export function writeLanguageCalibration(
  result: ReturnType<typeof calibrateLanguageDetection>,
): void {
  const detector = new URL("../../src/subtitles/language-detection.ts", import.meta.url);
  const algorithmSha256 = createHash("sha256").update(readFileSync(detector)).digest("hex");
  const record = { ...result, algorithmSha256 };
  writeFileSync(
    fileURLToPath(
      new URL(
        `../fixtures/languages/versions/${result.frozenRevision}/calibration-result.json`,
        import.meta.url,
      ),
    ),
    JSON.stringify({ ...record, manifestHash: corpusManifestHash(record) }, null, 2) + "\n",
  );
}
