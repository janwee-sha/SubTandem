import { francAll } from "franc-min";
import { getDetectorLanguage, TARGET_LANGUAGES } from "../domain/target-languages.js";
import type { SubtitleCue } from "./types.js";

const MAX_CUES_PER_WINDOW = 16;
const MAX_TEXT_PER_WINDOW = 1_000;
const MIN_CUES = 12;
const MIN_LETTERS = 200;
const MIN_SUPPORT = 0.8;
const MIN_MARGIN = 0.12;
const detectorCodes = Array.from(
  new Set(TARGET_LANGUAGES.flatMap((option) => (option.detectorCode ? [option.detectorCode] : []))),
);

export interface LanguageDetectionSampleWindow {
  readonly cues: readonly SubtitleCue[];
  readonly text: string;
}

export interface LanguageDetectionSample {
  readonly cues: readonly SubtitleCue[];
  readonly windows: readonly LanguageDetectionSampleWindow[];
  readonly text: string;
}

export type LanguageDetectionResult =
  | { readonly state: "reliable"; readonly languageId: string }
  | { readonly state: "unknown" }
  | { readonly state: "unsupported" };

type Classifier = (text: string) => Array<[string, number]>;

function isUsefulText(text: string): boolean {
  const value = text.trim();
  return Boolean(
    value &&
    !/^https?:\/\/\S+$/i.test(value) &&
    !/^[\p{N}\p{P}\p{S}\s]+$/u.test(value) &&
    /\p{L}/u.test(value),
  );
}

function trimUnicode(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

export function sampleSubtitleCues(cues: readonly SubtitleCue[]): LanguageDetectionSample {
  const ordered = [...cues].sort((left, right) =>
    left.startMs === right.startMs ? left.index - right.index : left.startMs - right.startMs,
  );
  const occurrences = new Map<string, number>();
  for (const cue of ordered) {
    const text = cue.normalizedText.trim();
    occurrences.set(text, (occurrences.get(text) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const windows: LanguageDetectionSampleWindow[] = [];
  for (let windowIndex = 0; windowIndex < 4; windowIndex += 1) {
    const start = Math.floor((ordered.length * windowIndex) / 4);
    const end = Math.floor((ordered.length * (windowIndex + 1)) / 4);
    const selected: SubtitleCue[] = [];
    let text = "";
    for (const cue of ordered.slice(start, end)) {
      const normalizedText = cue.normalizedText.trim();
      if (
        !isUsefulText(normalizedText) ||
        seen.has(normalizedText) ||
        (occurrences.get(normalizedText) ?? 0) > 1
      )
        continue;
      const separatorLength = text ? 1 : 0;
      const available = MAX_TEXT_PER_WINDOW - Array.from(text).length - separatorLength;
      if (available <= 0 || selected.length >= MAX_CUES_PER_WINDOW) break;
      const accepted = trimUnicode(normalizedText, available);
      if (!accepted) break;
      seen.add(normalizedText);
      selected.push(cue);
      text += `${separatorLength ? "\n" : ""}${accepted}`;
    }
    windows.push({ cues: selected, text });
  }
  const sampledCues = windows.flatMap((window) => window.cues);
  return { cues: sampledCues, windows, text: windows.map((window) => window.text).join("\n") };
}

function letterCount(value: string): number {
  return value.match(/\p{L}/gu)?.length ?? 0;
}

function dominantUnsupportedScript(value: string): boolean {
  const letters = letterCount(value);
  if (letters < MIN_LETTERS) return false;
  const unsupported =
    value.match(
      /[\p{Script=Armenian}\p{Script=Georgian}\p{Script=Khmer}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Canadian_Aboriginal}]/gu,
    )?.length ?? 0;
  return unsupported / letters >= 0.8;
}

function chineseLanguage(value: string): string | null {
  const letters = letterCount(value);
  const han = value.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = value.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  if (letters < MIN_LETTERS || kana > 0 || han / letters < 0.8) return null;
  const simplifiedCharacters = new Set(
    Array.from(value).filter((character) => /[发后里为云体国门东车书网头软]/.test(character)),
  ).size;
  const traditionalCharacters = new Set(
    Array.from(value).filter((character) => /[發後裡為雲體國門東車書網頭髮軟臺]/.test(character)),
  ).size;
  if (simplifiedCharacters >= 3 && simplifiedCharacters >= traditionalCharacters * 2)
    return "zh-Hans";
  if (traditionalCharacters >= 3 && traditionalCharacters >= simplifiedCharacters * 2)
    return "zh-Hant";
  return "zh";
}

function classify(classifier: Classifier, value: string): Array<[string, number]> {
  return classifier(value)
    .filter(([code, score]) => code !== "und" && Number.isFinite(score))
    .map(([code, score]) => [code, Math.max(0, Math.min(1, score)) ** 50]);
}

export function detectSubtitleLanguage(
  cues: readonly SubtitleCue[],
  options: { readonly classifier?: Classifier } = {},
): LanguageDetectionResult {
  try {
    const sample = sampleSubtitleCues(cues);
    if (sample.cues.length < MIN_CUES || letterCount(sample.text) < MIN_LETTERS)
      return { state: "unknown" };
    if (dominantUnsupportedScript(sample.text)) return { state: "unsupported" };
    const chinese = chineseLanguage(sample.text);
    if (chinese) return { state: "reliable", languageId: chinese };
    const classifier =
      options.classifier ?? ((text: string) => francAll(text, { only: detectorCodes }));
    const total = classify(classifier, sample.text);
    const first = total[0];
    if (!first) return { state: "unknown" };
    const margin = first[1] - (total[1]?.[1] ?? 0);
    if (margin < MIN_MARGIN) return { state: "unknown" };
    const validWindows = sample.windows.filter((window) => letterCount(window.text) > 0);
    const windowResults = validWindows.map((window) => ({
      weight: letterCount(window.text),
      code: classify(classifier, window.text)[0]?.[0] ?? "und",
    }));
    const matching = windowResults.filter((result) => result.code === first[0]);
    const totalWeight = windowResults.reduce((sum, result) => sum + result.weight, 0);
    const support = matching.reduce((sum, result) => sum + result.weight, 0) / totalWeight;
    if (matching.length < 3 || support < MIN_SUPPORT) return { state: "unknown" };
    const option = getDetectorLanguage(first[0]);
    return option ? { state: "reliable", languageId: option.id } : { state: "unsupported" };
  } catch {
    return { state: "unknown" };
  }
}
