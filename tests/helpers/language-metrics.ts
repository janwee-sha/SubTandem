import type { LanguageDetectionResult } from "../../src/subtitles/language-detection.js";
import type { LanguageSample } from "./language-corpus.js";

export interface LanguageMetricRow {
  record: LanguageSample;
  result: LanguageDetectionResult;
}
export function summarizeLanguageMetrics(rows: readonly LanguageMetricRow[]) {
  function count(group: readonly LanguageMetricRow[]) {
    const positive = group.filter(({ record }) => record.languageTruth.kind === "positive").length;
    const negative = group.length - positive;
    const correct = group.filter(
      ({ record, result }) =>
        result.state === "reliable" && result.languageId === record.languageTruth.languageId,
    ).length;
    const wrong = group.filter(
      ({ record, result }) =>
        result.state === "reliable" && result.languageId !== record.languageTruth.languageId,
    ).length;
    const negativeReliable = group.filter(
      ({ record, result }) =>
        record.languageTruth.kind === "negative" && result.state === "reliable",
    ).length;
    return {
      total: group.length,
      positive,
      negative,
      correct,
      unknown: group.length - correct - wrong,
      wrong,
      negativeReliable,
      correctRate: positive ? correct / positive : 0,
      wrongRate: group.length ? wrong / group.length : 0,
      negativeReliableRate: negative ? negativeReliable / negative : 0,
    };
  }
  const languages = [
    ...new Set(rows.map(({ record }) => record.languageTruth.languageId ?? "negative")),
  ].sort();
  const phenomena = [...new Set(rows.flatMap(({ record }) => record.phenomena))].sort();
  return {
    overall: count(rows),
    byLanguage: Object.fromEntries(
      languages.map((language) => [
        language,
        count(
          rows.filter(({ record }) => (record.languageTruth.languageId ?? "negative") === language),
        ),
      ]),
    ),
    byPhenomenon: Object.fromEntries(
      phenomena.map((phenomenon) => [
        phenomenon,
        count(rows.filter(({ record }) => record.phenomena.includes(phenomenon))),
      ]),
    ),
  };
}
