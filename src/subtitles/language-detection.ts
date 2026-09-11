import { francAll } from "franc";
import { data as modelData } from "franc/data.js";
import { getSourceLanguageForDetector } from "../domain/source-languages.js";
import type { SubtitleCue } from "./types.js";

export type LanguageDetectionUnknownReason =
  | "insufficient-evidence"
  | "ambiguous"
  | "unsupported"
  | "unmapped"
  | "error"
  | "timeout"
  | "interrupted";
export type LanguageDetectionResult =
  | { readonly state: "reliable"; readonly languageId: string }
  | { readonly state: "unknown"; readonly reason: LanguageDetectionUnknownReason };
export interface LanguageDetectionStep {
  readonly phase: "sampling" | "classifying";
  readonly processedCues: number;
  readonly processedCodeUnits: number;
}
export type LanguageDetectionWork = Iterator<LanguageDetectionStep, LanguageDetectionResult>;
export interface LanguageDetectionParameters {
  readonly minimumLatinLetters: number;
  readonly minimumOtherLetters: number;
  readonly shortMargin: number;
  readonly longMargin: number;
  readonly minimumScriptRatio: number;
  readonly minimumSupport: number;
  readonly minimumModelCoverage: number;
}
export const LANGUAGE_DETECTION_PARAMETERS: LanguageDetectionParameters = Object.freeze({
  minimumLatinLetters: 65,
  minimumOtherLetters: 40,
  shortMargin: 0.001,
  longMargin: 0.0001,
  minimumScriptRatio: 0.9,
  minimumSupport: 0.9,
  minimumModelCoverage: 0.2,
});

export interface LanguageDetectionOptions {
  readonly classifier?: (text: string) => Array<[string, number]>;
  readonly parameters?: LanguageDetectionParameters;
}
export interface LanguageDetectionSampleWindow {
  readonly cues: readonly SubtitleCue[];
  readonly text: string;
}
export interface LanguageDetectionSample {
  readonly cues: readonly SubtitleCue[];
  readonly windows: readonly LanguageDetectionSampleWindow[];
  readonly text: string;
}

function unknown(reason: LanguageDetectionUnknownReason): LanguageDetectionResult {
  return { state: "unknown", reason };
}
function safePrefix(value: string, limit: number): string {
  let end = Math.min(value.length, limit);
  if (
    end > 0 &&
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value.charAt(end - 1)) &&
    /[\uDC00-\uDFFF]/.test(value.charAt(end))
  )
    end--;
  return value.slice(0, end);
}
function letters(value: string): number {
  return value.match(/\p{L}/gu)?.length ?? 0;
}
function* sampleWork(
  cues: readonly SubtitleCue[],
): Generator<LanguageDetectionStep, LanguageDetectionSample> {
  const windows: Array<{ cues: SubtitleCue[]; text: string }> = Array.from({ length: 4 }, () => ({
    cues: [],
    text: "",
  }));
  const seen = new Set<string>();
  let processedCues = 0;
  let processedCodeUnits = 0;
  let used = 0;
  let count = 0;
  const short = cues.length <= 64;
  for (let region = 0; region < 4; region++) {
    const window = windows[region]!;
    const end = Math.floor((cues.length * (region + 1)) / 4);
    for (let index = Math.floor((cues.length * region) / 4); index < end; index++) {
      if (count >= 64 || (!short && (window.cues.length >= 16 || window.text.length >= 1023)))
        break;
      const raw = cues[index]!.normalizedText;
      let text = "";
      let inTag = false;
      for (let offset = 0; offset < raw.length && text.length < 4096;) {
        if (processedCodeUnits >= 12_288) {
          yield { phase: "sampling", processedCues, processedCodeUnits };
          processedCues = 0;
          processedCodeUnits = 0;
        }
        const chunk = safePrefix(raw.slice(offset, offset + 4097), 4096);
        offset += chunk.length;
        processedCodeUnits += chunk.length;
        for (let position = 0; position < chunk.length; position++) {
          const character = chunk.charAt(position);
          if (character === "<") inTag = true;
          else if (character === ">" && inTag) inTag = false;
          else if (!inTag) text += character;
        }
        text = safePrefix(text, 4096);
      }
      processedCues++;
      text = text
        .replace(
          /&(?:amp|lt|gt|quot|apos|nbsp);/g,
          (entity) =>
            ({
              "&amp;": "&",
              "&lt;": "<",
              "&gt;": ">",
              "&quot;": '"',
              "&apos;": "'",
              "&nbsp;": " ",
            })[entity] ?? " ",
        )
        .trim();
      if (text && !/^https?:\/\/\S+$/i.test(text) && /\p{L}/u.test(text) && !seen.has(text)) {
        const separator = count > 0 ? 1 : 0;
        const available = short
          ? 4096 - used - separator
          : 1023 - window.text.length - (window.text ? 1 : 0);
        const accepted = safePrefix(text, Math.max(0, available));
        if (accepted && /\p{L}/u.test(accepted)) {
          seen.add(text);
          window.cues.push(cues[index]!);
          window.text += (window.text ? "\n" : "") + accepted;
          used += accepted.length + separator;
          count++;
        }
      }
      if (processedCues >= 128) {
        yield { phase: "sampling", processedCues, processedCodeUnits };
        processedCues = 0;
        processedCodeUnits = 0;
      }
    }
  }
  if (processedCues || processedCodeUnits)
    yield { phase: "sampling", processedCues, processedCodeUnits };
  return {
    cues: windows.flatMap((window) => window.cues),
    windows,
    text: windows
      .map((window) => window.text)
      .filter(Boolean)
      .join("\n"),
  };
}
export function sampleSubtitleCues(cues: readonly SubtitleCue[]): LanguageDetectionSample {
  const work = sampleWork(cues);
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
function fragments(text: string): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < text.length && result.length < 4;) {
    let part = safePrefix(text.slice(offset, offset + 2049), 2048);
    if (offset + part.length < text.length) {
      const boundary = Math.max(part.lastIndexOf("\n"), part.lastIndexOf(" "));
      if (boundary >= 1024) part = part.slice(0, boundary + 1);
    }
    result.push(part);
    offset += part.length;
  }
  return result;
}
const scriptExpressions = {
  Latin: /\p{Script=Latin}/gu,
  Cyrillic: /\p{Script=Cyrillic}/gu,
  Arabic: /\p{Script=Arabic}/gu,
  Devanagari: /\p{Script=Devanagari}/gu,
  cmn: /\p{Script=Han}/gu,
  jpn: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  heb: /\p{Script=Hebrew}/gu,
  ell: /\p{Script=Greek}/gu,
  hye: /\p{Script=Armenian}/gu,
  kat: /\p{Script=Georgian}/gu,
  khm: /\p{Script=Khmer}/gu,
  lao: /\p{Script=Lao}/gu,
  bod: /\p{Script=Tibetan}/gu,
  ben: /\p{Script=Bengali}/gu,
  kor: /\p{Script=Hangul}/gu,
  tel: /\p{Script=Telugu}/gu,
  tam: /\p{Script=Tamil}/gu,
  guj: /\p{Script=Gujarati}/gu,
  kan: /\p{Script=Kannada}/gu,
  mal: /\p{Script=Malayalam}/gu,
  mya: /\p{Script=Myanmar}/gu,
  sin: /\p{Script=Sinhala}/gu,
  tha: /\p{Script=Thai}/gu,
  jav: /\p{Script=Javanese}/gu,
};
function evidence(text: string) {
  const count = letters(text);
  const counts = new Map<string, number>();
  for (const [script, expression] of Object.entries(scriptExpressions))
    counts.set(
      script,
      text.match(expression)?.filter((character) => /\p{L}/u.test(character)).length ?? 0,
    );
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const romanized = words.filter((word) => word.length >= 3);
  const romaji =
    romanized.length >= 8 &&
    romanized.filter(
      (word) =>
        word.length <= 64 &&
        /^(?:(?:[kgshnmrbp]y|sh|ch|ts|[kgstnhmyrwgzdbpfj])?[aeiou]|n|[kstp](?=[kstp]))+$/.test(
          word,
        ),
    ).length /
      romanized.length >=
      0.85;
  return {
    count,
    counts,
    latin: (counts.get("Latin") ?? 0) / Math.max(1, count),
    scriptRatio: Math.max(...counts.values()) / Math.max(1, count),
    unique: new Set(text.toLowerCase().match(/\p{L}/gu) ?? []).size,
    words: new Set(words).size,
    romaji,
  };
}
interface Classification {
  weight: number;
  leader: string;
  code: string;
  scores: Map<string, number>;
  coverage: number;
}
const modelTrigrams = new Map<string, Set<string> | null>();
function modelCoverage(text: string, code: string): number {
  if (!modelTrigrams.has(code)) {
    const models = Object.values(modelData).flatMap((group) => (group[code] ? [group[code]!] : []));
    modelTrigrams.set(code, models.length ? new Set(models.join("|").split("|")) : null);
  }
  const model = modelTrigrams.get(code);
  if (!model) return 1;
  const normalized = ` ${text
    .replace(/[\u0021-\u0040]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()} `;
  let matches = 0;
  for (let index = 0; index < normalized.length - 2; index++)
    if (model.has(normalized.slice(index, index + 3))) matches++;
  return matches / Math.max(1, normalized.length - 2);
}
function identity(code: string): string {
  return getSourceLanguageForDetector(code)?.id ?? `model:${code}`;
}
function classify(
  text: string,
  classifier: (text: string) => Array<[string, number]>,
): Classification {
  const candidates = classifier(text).filter(
    ([code, score]) => code !== "und" && Number.isFinite(score),
  );
  const scores = new Map<string, number>();
  for (const [code, score] of candidates) {
    const key = identity(code);
    scores.set(key, Math.max(scores.get(key) ?? 0, Math.max(0, Math.min(1, score))));
  }
  const leader = [...scores].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
  const code = candidates.find(([code]) => identity(code) === leader)?.[0] ?? "und";
  return {
    weight: letters(text),
    leader,
    code,
    scores,
    coverage: modelCoverage(text, code),
  };
}
function decide(
  text: string,
  results: Classification[],
  parameters: LanguageDetectionParameters,
): LanguageDetectionResult {
  const value = evidence(text);
  if (
    value.count <
      (value.latin >= 0.5 ? parameters.minimumLatinLetters : parameters.minimumOtherLetters) ||
    value.unique < 8 ||
    (value.latin >= 0.5 && value.words < 5)
  )
    return unknown("insufficient-evidence");
  if (value.scriptRatio < parameters.minimumScriptRatio || (value.latin >= 0.95 && value.romaji))
    return unknown("ambiguous");
  const weight = results.reduce((sum, result) => sum + result.weight, 0);
  const aggregate = new Map<string, number>();
  for (const result of results)
    for (const [key, score] of result.scores)
      aggregate.set(key, (aggregate.get(key) ?? 0) + (score * result.weight) / weight);
  const ranked = [...aggregate].sort((left, right) => right[1] - left[1]);
  const first = ranked[0];
  if (!first) return unknown("unsupported");
  if (
    results.reduce((sum, result) => sum + result.coverage * result.weight, 0) / weight <
    parameters.minimumModelCoverage
  )
    return unknown("ambiguous");
  const support =
    results
      .filter((result) => result.leader === first[0])
      .reduce((sum, result) => sum + result.weight, 0) / weight;
  if (support < parameters.minimumSupport) return unknown("ambiguous");
  if (ranked.length === 1) {
    const code = results[0]?.code ?? "und";
    const supported = value.counts.get(code) ?? 0;
    const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    if (
      supported / value.count < parameters.minimumScriptRatio ||
      value.unique < 12 ||
      (code === "cmn" && kana > 0) ||
      (code === "jpn" && kana < 5)
    )
      return unknown("ambiguous");
  } else if (
    first[1] - ranked[1]![1] <
    (value.count < 200 ? parameters.shortMargin : parameters.longMargin)
  )
    return unknown("ambiguous");
  if (first[0].startsWith("model:")) return unknown("unmapped");
  return { state: "reliable", languageId: first[0] };
}
export function* createLanguageDetectionWork(
  cues: readonly SubtitleCue[],
  options: LanguageDetectionOptions = {},
): Generator<LanguageDetectionStep, LanguageDetectionResult> {
  try {
    const sample = yield* sampleWork(cues);
    if (!/\p{L}/u.test(sample.text)) return unknown("insufficient-evidence");
    const results: Classification[] = [];
    for (const fragment of fragments(sample.text)) {
      results.push(classify(fragment, options.classifier ?? francAll));
      yield { phase: "classifying", processedCues: 0, processedCodeUnits: fragment.length };
    }
    return decide(sample.text, results, options.parameters ?? LANGUAGE_DETECTION_PARAMETERS);
  } catch {
    return unknown("error");
  }
}
export function detectSubtitleLanguage(
  cues: readonly SubtitleCue[],
  options: LanguageDetectionOptions = {},
): LanguageDetectionResult {
  const work = createLanguageDetectionWork(cues, options);
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
