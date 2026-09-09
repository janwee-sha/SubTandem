import {
  detectSubtitleLanguage,
  type LanguageDetectionParameters,
} from "../../src/subtitles/language-detection.js";
import {
  evaluationOutcome,
  summarizeCorpus,
  type LoadedCorpus,
  type LoadedSample,
} from "./language-corpus.js";

export function requiresAccurateCandidate(sample: LoadedSample): boolean {
  return (
    sample.kind === "controlled-mix" ||
    sample.tags.some((tag) =>
      [
        "german-eleven",
        "english-ass",
        "hungarian-nineteen",
        "italian-nineteen",
        "russian-nineteen",
        "swedish-nineteen",
        "five-six-latin",
        "five-six-distinct-script",
        "natural-hausa",
        "natural-mixed",
        "majority",
        "40-35-25",
        "supported-tie",
        "unsupported-majority",
        "unsupported-combined-majority",
        "small-supported-share",
        "supported-unsupported-tie",
      ].includes(tag),
    )
  );
}

export function calibrateLanguageDetection(corpus: LoadedCorpus) {
  if (corpus.manifest.split !== "calibration") throw new Error("CALIBRATION_SPLIT_REQUIRED");
  const configurations = [];
  for (const totalLetterBudget of [4096, 8192, 16384])
    for (const spanLetterBudget of [128, 256, 512])
      for (const contextLimit of [512, 1024, 2048])
        for (const unsupportedMargin of [0.02, 0.05, 0.1]) {
          const parameters: LanguageDetectionParameters = {
            totalLetterBudget,
            spanLetterBudget,
            contextLimit,
            unsupportedMargin,
            minLength: 0,
          };
          const failures: string[] = [];
          const records = corpus.samples.map((sample) => {
            const started = performance.now();
            const result = detectSubtitleLanguage(sample.cues, { parameters });
            const elapsedMs = performance.now() - started;
            const outcome = evaluationOutcome(sample, result);
            if (
              sample.truth.behavior === "candidate"
                ? result.state !== "reliable"
                : result.state !== sample.truth.behavior
            )
              failures.push(`${sample.sampleId}:behavior`);
            if (
              requiresAccurateCandidate(sample) &&
              sample.truth.behavior === "candidate" &&
              outcome !== "correct"
            )
              failures.push(`${sample.sampleId}:required-accuracy`);
            if (
              sample.tags.includes("supported-tie") &&
              JSON.stringify(detectSubtitleLanguage(sample.cues, { parameters })) !==
                JSON.stringify(result)
            )
              failures.push(`${sample.sampleId}:unstable-tie`);
            return { sampleId: sample.sampleId, result, outcome, elapsedMs, providerCalls: 0 };
          });
          const strata = summarizeCorpus(corpus, records);
          const groups = ["positive", "positive:short", "positive:medium", "positive:long"].map(
            (name) => strata.find((group) => group.stratum === name)!,
          );
          for (const group of groups)
            if (
              group.counts.correct / group.denominator < 0.95 ||
              (group.counts.unknown + group.counts.unsupported) / group.denominator > 0.05
            )
              failures.push(`${group.stratum}:accuracy`);
          const byId = new Map(records.map((record) => [record.sampleId, record]));
          for (const sample of corpus.samples.filter(
            (item) => item.kind === "variant" && !item.tags.includes("translation"),
          ))
            if (
              JSON.stringify(byId.get(sample.sampleId)!.result) !==
              JSON.stringify(byId.get(sample.derivedFrom[0]!)!.result)
            )
              failures.push(`${sample.sampleId}:variant`);
          const outside = corpus.samples.filter(
            (sample) => sample.truth.behavior === "unsupported",
          );
          configurations.push({
            parameters,
            failures,
            positiveGroups: groups,
            worstLengthAccuracy: Math.min(
              ...groups.slice(1).map((group) => group.counts.correct / group.denominator),
            ),
            overallAccuracy: groups[0]!.counts.correct / groups[0]!.denominator,
            outsideAccuracy:
              outside.filter((sample) => byId.get(sample.sampleId)!.result.state === "unsupported")
                .length / outside.length,
          });
        }
  const candidates = configurations
    .filter((configuration) => configuration.failures.length === 0)
    .sort(
      (a, b) =>
        b.worstLengthAccuracy - a.worstLengthAccuracy ||
        b.overallAccuracy - a.overallAccuracy ||
        b.outsideAccuracy - a.outsideAccuracy ||
        a.parameters.totalLetterBudget - b.parameters.totalLetterBudget ||
        a.parameters.spanLetterBudget - b.parameters.spanLetterBudget ||
        a.parameters.contextLimit - b.parameters.contextLimit ||
        a.parameters.unsupportedMargin - b.parameters.unsupportedMargin,
    );
  return {
    schemaVersion: 1,
    corpusVersion: corpus.manifest.version,
    calibrationHashes: corpus.hashes,
    configurationCount: configurations.length,
    behaviorQualifiedCount: candidates.length,
    preferredParameters: candidates[0]?.parameters ?? null,
    candidates: candidates.map((candidate) => candidate.parameters),
    configurations,
  };
}
