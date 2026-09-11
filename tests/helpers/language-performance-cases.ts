import type { SubtitleCue } from "../../src/subtitles/types.js";

export const LANGUAGE_PERFORMANCE_CASES = [
  "maximum",
  "preprocessing",
  "shared-script",
  "high-trigram",
  "reliable",
] as const;
export type LanguagePerformanceCase = (typeof LANGUAGE_PERFORMANCE_CASES)[number];
const sentences = [
  "We need to close the windows before the rain starts, because the children are asleep upstairs.",
  "When the train finally arrived at the station, everyone picked up their bags and walked outside.",
  "I thought you had already called the office to explain why we could not attend the meeting.",
  "The road was blocked by a fallen tree, so we turned around and went back through the village.",
];
export function languagePerformanceCues(kind: LanguagePerformanceCase): SubtitleCue[] {
  let random = 1729;
  function noise() {
    let text = "";
    for (let i = 0; i < 200; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      text += String.fromCharCode(97 + (random % 26));
    }
    return text;
  }
  const count = kind === "preprocessing" ? 20_000 : 64;
  return Array.from({ length: count }, (_, index) => {
    const text =
      kind === "preprocessing"
        ? index % 5000 === 4999
          ? sentences[index % 4]!
          : "1234567890"
        : kind === "high-trigram"
          ? noise()
          : kind === "shared-script"
            ? `Мы должны закрыть окна до начала дождя, потому что дети уже спят наверху. ${index}`
            : `${sentences[index % 4]} ${kind === "maximum" ? sentences[(index + 1) % 4] : ""} ${index}`;
    return {
      id: `performance-${index}`,
      index,
      startMs: index * 1000,
      endMs: index * 1000 + 900,
      sourceText: text,
      normalizedText: text,
    };
  });
}
export function percentile(values: readonly number[], quantile: number): number {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1] ?? Infinity;
}
