import { francAll } from "franc";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createLanguageDetectionWork,
  LANGUAGE_DETECTION_PARAMETERS,
  sampleSubtitleCues,
  type LanguageDetectionParameters,
  type LanguageEvidenceDecision,
} from "../../src/subtitles/language-detection.js";
import { getSourceLanguageForDetector } from "../../src/domain/source-languages.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import { corpusManifestHash, loadVersionedLanguageCorpus } from "./language-corpus.js";
import { summarizeLanguageMetrics } from "./language-metrics.js";

export function traceLanguageDetection(
  cues: readonly SubtitleCue[],
  parameters = LANGUAGE_DETECTION_PARAMETERS,
) {
  let candidates: Array<[string, number]> = [];
  const work = createLanguageDetectionWork(cues, {
    parameters,
    classifier: (text) => (candidates = francAll(text, { minLength: 1 })),
  });
  const intervals: LanguageEvidenceDecision[] = [];
  const contexts: Array<{ fragment: number; candidates: Array<[string, number]> }> = [];
  for (;;) {
    const step = work.next();
    if (step.done) {
      const sampleLetters = sampleSubtitleCues(cues).text.match(/\p{L}/gu)?.length ?? 0;
      const assigned: Record<string, number> = {};
      const rejected: Record<string, number> = {};
      for (const interval of intervals) {
        const counts = interval.language ? assigned : rejected;
        const key = interval.language ?? interval.reason;
        counts[key] = (counts[key] ?? 0) + interval.letters;
      }
      return { result: step.value, sampleLetters, assigned, rejected, contexts, intervals };
    }
    if (step.value.evidence) intervals.push(step.value.evidence);
    else if (step.value.phase === "classifying")
      contexts.push({
        fragment: step.value.fragment!,
        candidates: candidates
          .slice(0, 5)
          .map(([code, score]) => [
            getSourceLanguageForDetector(code)?.id ?? `model:${code}`,
            score,
          ]),
      });
  }
}

export function diagnoseLanguageDetection(
  parameters: LanguageDetectionParameters = LANGUAGE_DETECTION_PARAMETERS,
) {
  const corpus = loadVersionedLanguageCorpus("calibration");
  const rows = corpus.tracks.map(({ record, cues }) => ({
    record,
    ...traceLanguageDetection(cues, parameters),
  }));
  const summary = summarizeLanguageMetrics(rows);
  const failures = rows
    .filter(
      ({ record, result }) =>
        record.languageTruth.kind === "positive" &&
        (result.state !== "reliable" || result.languageId !== record.languageTruth.languageId),
    )
    .map(({ record, ...trace }) => ({
      sampleId: record.sampleId,
      truth: record.languageTruth.languageId,
      ...trace,
    }));
  const variants: Array<{
    name: string;
    parameters: LanguageDetectionParameters;
    collapseLines?: boolean;
  }> = [
    { name: "without-context", parameters: { ...LANGUAGE_DETECTION_PARAMETERS, contextWeight: 0 } },
    {
      name: "without-local-override",
      parameters: {
        ...LANGUAGE_DETECTION_PARAMETERS,
        independentEvidence: Number.MAX_SAFE_INTEGER,
      },
    },
    {
      name: "cue-without-line-breaks",
      parameters: LANGUAGE_DETECTION_PARAMETERS,
      collapseLines: true,
    },
  ];
  const ablations = Object.fromEntries(
    variants.map((variant) => [
      variant.name,
      summarizeLanguageMetrics(
        corpus.tracks.map(({ record, cues }) => ({
          record,
          result: traceLanguageDetection(
            variant.collapseLines
              ? cues.map((cue) => ({
                  ...cue,
                  normalizedText: cue.normalizedText.replaceAll("\n", " "),
                }))
              : cues,
            variant.parameters,
          ).result,
        })),
      ).overall,
    ]),
  );
  const rejectedLetters: Record<string, number> = {};
  for (const row of rows)
    for (const [reason, count] of Object.entries(row.rejected))
      rejectedLetters[reason] = (rejectedLetters[reason] ?? 0) + count;
  return {
    schemaVersion: 1,
    frozenRevision: corpus.manifest.frozenRevision,
    calibrationManifestHash: corpus.manifest.manifestHash,
    algorithmSha256: createHash("sha256")
      .update(readFileSync(new URL("../../src/subtitles/language-detection.ts", import.meta.url)))
      .digest("hex"),
    parameters,
    summary,
    ablations,
    rejectedLetters,
    evidenceAccountingValid: rows.every((row) => {
      const examined = row.intervals.reduce((sum, part) => sum + part.letters, 0);
      return (
        examined <= row.sampleLetters &&
        row.intervals.every(
          (part, index) =>
            part.end > part.start && (index === 0 || part.start >= row.intervals[index - 1]!.end),
        )
      );
    }),
    failures,
  };
}

export function writeLanguageDiagnosis(result: ReturnType<typeof diagnoseLanguageDetection>) {
  writeFileSync(
    new URL(
      `../fixtures/languages/versions/${result.frozenRevision}/diagnosis-result.json`,
      import.meta.url,
    ),
    JSON.stringify({ ...result, manifestHash: corpusManifestHash(result) }, null, 2) + "\n",
  );
}
