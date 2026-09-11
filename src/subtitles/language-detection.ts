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
  readonly fragment?: number;
  readonly processedCues: number;
  readonly processedCodeUnits: number;
  readonly evidence?: LanguageEvidenceDecision;
}
export interface LanguageEvidenceDecision {
  readonly start: number;
  readonly end: number;
  readonly letters: number;
  readonly localLeader: string;
  readonly contextLeader: string;
  readonly modelCode: string;
  readonly language: string | null;
  readonly reason:
    | "assigned"
    | "letters"
    | "diversity"
    | "proper-names"
    | "romanized"
    | "rhythmic"
    | "fabricated"
    | "unsupported"
    | "coverage"
    | "model-fit"
    | "single-model"
    | "margin";
  readonly margin: number;
  readonly coverage: number;
  readonly density: number;
}
export type LanguageDetectionWork = Iterator<LanguageDetectionStep, LanguageDetectionResult>;
export interface LanguageDetectionParameters {
  readonly minimumLatinLetters: number;
  readonly minimumOtherLetters: number;
  readonly shortMargin: number;
  readonly longMargin: number;
  readonly minimumSegmentLetters: number;
  readonly contextWeight: number;
  readonly minimumModelCoverage: number;
  readonly independentEvidence: number;
  readonly modelEvidenceWeight: number;
}
export const LANGUAGE_DETECTION_PARAMETERS: LanguageDetectionParameters = Object.freeze({
  minimumLatinLetters: 65,
  minimumOtherLetters: 18,
  shortMargin: 0.005,
  longMargin: 0.001,
  minimumSegmentLetters: 5,
  contextWeight: 1,
  minimumModelCoverage: 0.2,
  independentEvidence: 6,
  modelEvidenceWeight: 0.2,
});

export const LANGUAGE_CANDIDATE_SCORE_BIASES: Readonly<Record<string, number>> = Object.freeze({
  bg: -0.05,
  cs: 0.025,
  en: 0.16,
  es: 0.145,
  gl: -0.145,
  hmn: -0.135,
  hu: -0.025,
  id: 0.05,
  mk: -0.15,
  "model:sco": -0.025,
  ms: -0.05,
  ru: 0.2,
});
export const LANGUAGE_CANDIDATE_MINIMUM_MODEL_DENSITY: Readonly<Record<string, number>> =
  Object.freeze({ lua: 0.08, ms: 0.08 });
export const LANGUAGE_SHARED_MODEL_EVIDENCE: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["id", "ms"]),
]);
export const LANGUAGE_LEXICAL_EVIDENCE: Readonly<
  Record<string, { readonly weight: number; readonly words: readonly string[] }>
> = Object.freeze({
  id: Object.freeze({
    weight: 0.06,
    words: Object.freeze([
      "karena",
      "bisa",
      "harus",
      "mau",
      "nggak",
      "enggak",
      "gak",
      "gue",
      "kalian",
      "punya",
      "butuh",
    ]),
  }),
  ms: Object.freeze({
    weight: 0.06,
    words: Object.freeze([
      "kerana",
      "mahu",
      "awak",
      "ialah",
      "boleh",
      "sahaja",
      "bahawa",
      "hendak",
    ]),
  }),
  ru: Object.freeze({
    weight: 0.4,
    words: Object.freeze([
      "это",
      "что",
      "чтобы",
      "когда",
      "почему",
      "потому",
      "который",
      "которая",
      "которые",
      "есть",
      "был",
      "была",
      "будет",
      "нет",
      "уже",
      "ещё",
      "меня",
      "тебя",
    ]),
  }),
  bg: Object.freeze({
    weight: 0.4,
    words: Object.freeze([
      "съм",
      "сме",
      "сте",
      "ще",
      "няма",
      "като",
      "това",
      "този",
      "тази",
      "тези",
      "какво",
      "защо",
      "защото",
      "който",
      "която",
      "които",
      "във",
      "със",
    ]),
  }),
  sv: Object.freeze({
    weight: 0.02,
    words: Object.freeze(["och", "att", "inte", "jag", "är", "vad", "vem", "varför", "också"]),
  }),
  no: Object.freeze({
    weight: 0.02,
    words: Object.freeze(["og", "ikke", "jeg", "er", "hva", "hvem", "hvorfor", "også"]),
  }),
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
  readonly intervals: ReadonlyArray<{ start: number; end: number }>;
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
interface SamplingBudget {
  processedCues: number;
  processedCodeUnits: number;
}
interface PreparedEvidence {
  cue: SubtitleCue;
  text: string;
  regions: string[];
  oversized: boolean;
}
function* accountCue(budget: SamplingBudget): Generator<LanguageDetectionStep> {
  budget.processedCues++;
  if (budget.processedCues >= 128) {
    yield { phase: "sampling", ...budget };
    budget.processedCues = 0;
    budget.processedCodeUnits = 0;
  }
}
function* prepareEvidence(
  cue: SubtitleCue,
  budget: SamplingBudget,
): Generator<LanguageDetectionStep, PreparedEvidence> {
  const raw = cue.normalizedText;
  const regions = ["", "", "", ""];
  let text = "";
  let contentLength = 0;
  let trimmedLength = 0;
  let inTag = false;
  for (let offset = 0; offset < raw.length;) {
    if (budget.processedCodeUnits >= 12_288) {
      yield { phase: "sampling", ...budget };
      budget.processedCues = 0;
      budget.processedCodeUnits = 0;
    }
    const region = Math.min(3, Math.floor((offset * 4) / raw.length));
    let character = String.fromCodePoint(raw.codePointAt(offset)!);
    let width = character.length;
    if (character === "&") {
      const entity = raw.slice(offset, offset + 6).match(/^&(?:amp|lt|gt|quot|apos|nbsp);/u)?.[0];
      if (entity) {
        character = (
          {
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&apos;": "'",
            "&nbsp;": " ",
          } as Record<string, string>
        )[entity]!;
        width = entity.length;
      }
    }
    offset += width;
    budget.processedCodeUnits += width;
    if (character === "<" && width === 1) inTag = true;
    else if (character === ">" && width === 1 && inTag) inTag = false;
    else if (!inTag) {
      if (contentLength > 0 || character.trim()) {
        contentLength += character.length;
        if (character.trim()) trimmedLength = contentLength;
        if (text.length + character.length <= 4097) text += character;
      }
      if (regions[region]!.length + character.length <= 1023) regions[region] += character;
    }
  }
  yield* accountCue(budget);
  return {
    cue,
    text: text.trim(),
    regions: regions.map((part) => part.trim()),
    oversized: trimmedLength > 4096,
  };
}
function usefulEvidence(text: string): boolean {
  return /\p{L}/u.test(text) && !/^https?:\/\/\S+$/iu.test(text);
}
function* sampleWork(
  cues: readonly SubtitleCue[],
): Generator<LanguageDetectionStep, LanguageDetectionSample> {
  const budget: SamplingBudget = { processedCues: 0, processedCodeUnits: 0 };
  const prepared = new Map<number, PreparedEvidence>();
  const seen = new Set<string>();
  const all: Array<{ index: number; evidence: PreparedEvidence }> = [];
  let used = 0;
  let overflow = false;
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]!;
    if (seen.has(cue.normalizedText)) {
      yield* accountCue(budget);
      continue;
    }
    const evidence = yield* prepareEvidence(cue, budget);
    if (!usefulEvidence(evidence.text) && !evidence.regions.some(usefulEvidence)) continue;
    const key = evidence.oversized ? cue.normalizedText : evidence.text;
    if (seen.has(key)) continue;
    seen.add(key);
    prepared.set(index, evidence);
    used += evidence.text.length + (all.length ? 1 : 0);
    all.push({ index, evidence });
    if (all.length > 64 || used > 4096 || evidence.oversized) {
      overflow = true;
      break;
    }
  }
  const windows: Array<{
    cues: SubtitleCue[];
    text: string;
    intervals: Array<{ start: number; end: number }>;
  }> = Array.from({ length: 4 }, () => ({ cues: [], text: "", intervals: [] }));
  const append = (region: number, cue: SubtitleCue, text: string) => {
    if (!usefulEvidence(text)) return;
    const window = windows[region]!;
    if (!window.cues.includes(cue)) window.cues.push(cue);
    const start = window.text.length + (window.text ? 1 : 0);
    window.intervals.push({ start, end: start + text.length });
    window.text += (window.text ? "\n" : "") + text;
  };
  if (!overflow) {
    for (const { index, evidence } of all)
      append(
        Math.min(3, Math.floor((index * 4) / Math.max(1, cues.length))),
        evidence.cue,
        evidence.text,
      );
  } else if (cues.length === 1) {
    for (let region = 0; region < 4; region++)
      append(region, cues[0]!, all[0]!.evidence.regions[region]!);
  } else {
    seen.clear();
    for (let region = 0; region < 4; region++) {
      const selected: PreparedEvidence[] = [];
      for (
        let index = Math.floor((cues.length * region) / 4);
        index < Math.floor((cues.length * (region + 1)) / 4);
        index++
      ) {
        if (selected.length >= 16) break;
        const cue = cues[index]!;
        if (seen.has(cue.normalizedText)) {
          yield* accountCue(budget);
          continue;
        }
        const evidence = prepared.get(index) ?? (yield* prepareEvidence(cue, budget));
        const key = evidence.oversized ? cue.normalizedText : evidence.text;
        if (
          seen.has(key) ||
          (!usefulEvidence(evidence.text) && !evidence.regions.some(usefulEvidence))
        )
          continue;
        seen.add(key);
        selected.push(evidence);
      }
      const limits = selected.map(() => 0);
      let remaining = 1023 - Math.max(0, selected.length - 1);
      for (;;) {
        const open = selected
          .map((evidence, index) => ({ evidence, index }))
          .filter(({ evidence, index }) => limits[index]! < evidence.text.length);
        if (!open.length || remaining <= 0) break;
        const share = Math.max(1, Math.floor(remaining / open.length));
        for (const { evidence, index } of open) {
          const added = Math.min(share, evidence.text.length - limits[index]!, remaining);
          limits[index]! += added;
          remaining -= added;
        }
      }
      for (const [index, evidence] of selected.entries()) {
        const limit = limits[index]!;
        const text = evidence.oversized
          ? evidence.regions
              .map((part) => safePrefix(part, Math.max(0, Math.floor((limit - 3) / 4))))
              .filter(Boolean)
              .join("\n")
          : safePrefix(evidence.text, limit);
        append(region, evidence.cue, text);
      }
    }
  }
  if (budget.processedCues || budget.processedCodeUnits) yield { phase: "sampling", ...budget };
  let offset = 0;
  const intervals = windows.flatMap((window) => {
    if (!window.text) return [];
    const result = window.intervals.map((interval) => ({
      start: interval.start + offset,
      end: interval.end + offset,
    }));
    offset += window.text.length + 1;
    return result;
  });
  return {
    intervals,
    cues: [...new Set(windows.flatMap((window) => window.cues))],
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
function fragments(sample: LanguageDetectionSample): string[] {
  const text = sample.text;
  const windows = sample.windows.filter((window) => window.text.length > 0);
  if (text.length > 2048 && windows.every((window) => window.text.length < 2048))
    return windows.map((window, index) => window.text + (index < windows.length - 1 ? "\n" : ""));
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
  const syllabic = /^(?:[bcdfghjklmnpqrstvwxyz]{1,2}[aeiou])+(?:[bcdfghjklmnpqrstvwxyz])?$/;
  const fabricated =
    words.length >= 12 &&
    new Set(words).size / words.length >= 0.9 &&
    words.filter((word) => word.length >= 4 && word.length <= 5).length / words.length >= 0.9 &&
    words.filter((word) => syllabic.test(word)).length / words.length >= 0.9;
  return {
    count,
    counts,
    latin: (counts.get("Latin") ?? 0) / Math.max(1, count),
    properNames:
      words.length >= 3 &&
      (text.match(/\p{L}+/gu) ?? []).every((word) => /^\p{Lu}\p{Ll}+$/u.test(word)),
    unique: new Set(text.toLowerCase().match(/\p{L}/gu) ?? []).size,
    words: new Set(words).size,
    romaji,
    fabricated,
    rhythmic:
      words.length >= 8 &&
      words.filter((word) => /^([a-z]{1,3})\1+$/.test(word)).length / words.length >= 0.2,
  };
}
interface Classification {
  weight: number;
  leader: string;
  code: string;
  scores: Map<string, number>;
  codes: Map<string, string>;
  densities: Map<string, number>;
}
const modelTrigrams = new Map<string, Set<string> | null>();
interface ModelEvidenceGroup {
  readonly size: number;
  readonly codes: Set<string>;
  readonly weights: Map<string, Array<[string, number]>>;
}
const modelEvidenceGroups = new Map<string, ModelEvidenceGroup[]>();
let modelsPrepared = false;
function prepareModels(): void {
  if (modelsPrepared) return;
  for (const group of Object.values(modelData)) {
    const models = Object.entries(group).map(([code, serialized]) => ({
      code,
      trigrams: serialized.split("|"),
    }));
    const frequencies = new Map<string, number>();
    for (const model of models)
      for (const trigram of new Set(model.trigrams))
        frequencies.set(trigram, (frequencies.get(trigram) ?? 0) + 1);
    const weights = new Map<string, Array<[string, number]>>();
    for (const model of models)
      for (const [rank, trigram] of model.trigrams.entries()) {
        const rarity =
          Math.log((models.length + 1) / ((frequencies.get(trigram) ?? 0) + 1)) /
          Math.log(models.length + 1);
        const weight = rarity * (1 - rank / Math.max(1, model.trigrams.length));
        const values = weights.get(trigram) ?? [];
        values.push([model.code, weight]);
        weights.set(trigram, values);
      }
    const evidenceGroup = {
      size: models.length,
      codes: new Set(models.map(({ code }) => code)),
      weights,
    };
    for (const model of models) {
      const combined = modelTrigrams.get(model.code) ?? new Set<string>();
      for (const trigram of model.trigrams) combined.add(trigram);
      modelTrigrams.set(model.code, combined);
      const groups = modelEvidenceGroups.get(model.code) ?? [];
      groups.push(evidenceGroup);
      modelEvidenceGroups.set(model.code, groups);
    }
  }
  modelsPrepared = true;
}
function modelFor(code: string): Set<string> | null {
  prepareModels();
  if (!modelTrigrams.has(code)) modelTrigrams.set(code, null);
  return modelTrigrams.get(code) ?? null;
}
function normalizeForModel(text: string): string {
  return ` ${text
    .replace(/[\u0021-\u0040]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()} `;
}
function modelCoverage(text: string, code: string): number {
  const model = modelFor(code);
  if (!model) return 1;
  const normalized = normalizeForModel(text);
  let matches = 0;
  for (let index = 0; index < normalized.length - 2; index++)
    if (model.has(normalized.slice(index, index + 3))) matches++;
  return matches / Math.max(1, normalized.length - 2);
}
function modelEvidence(
  text: string,
  group: ModelEvidenceGroup,
): { scores: Map<string, number>; observed: number } {
  prepareModels();
  const result = new Map<string, number>();
  const normalized = normalizeForModel(text);
  const observed = new Set<string>();
  for (let index = 0; index < normalized.length - 2; index++)
    observed.add(normalized.slice(index, index + 3));
  for (const trigram of observed)
    for (const [code, weight] of group.weights.get(trigram) ?? [])
      result.set(code, (result.get(code) ?? 0) + weight);
  return { scores: result, observed: observed.size };
}
function identity(code: string): string {
  return getSourceLanguageForDetector(code)?.id ?? `model:${code}`;
}
function lexicalEvidence(text: string): Map<string, number> {
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  return new Map(
    Object.entries(LANGUAGE_LEXICAL_EVIDENCE).map(([language, rule]) => [
      language,
      rule.words.filter((word) => words.has(word)).length * rule.weight,
    ]),
  );
}
function classify(
  text: string,
  classifier: (text: string) => Array<[string, number]>,
  modelEvidenceWeight: number,
): Classification {
  const candidates = classifier(text).filter(
    ([code, score]) => code !== "und" && Number.isFinite(score),
  );
  prepareModels();
  const candidateCodes = [...new Set(candidates.map(([code]) => code))];
  const group = (modelEvidenceGroups.get(candidateCodes[0] ?? "") ?? []).find(
    (candidateGroup) =>
      candidateCodes.length === candidateGroup.size &&
      candidateCodes.every((code) => candidateGroup.codes.has(code)),
  );
  const calibrated = group !== undefined;
  const model = group
    ? modelEvidence(text, group)
    : { scores: new Map<string, number>(), observed: 0 };
  const sharedModelScores = new Map(model.scores);
  for (const family of LANGUAGE_SHARED_MODEL_EVIDENCE) {
    const codes = candidateCodes.filter((code) => family.includes(identity(code)));
    const score = Math.max(...codes.map((code) => model.scores.get(code) ?? 0), 0);
    for (const code of codes) sharedModelScores.set(code, score);
  }
  const lexicalScores = calibrated ? lexicalEvidence(text) : new Map<string, number>();
  const adjusted = candidates.map(
    ([code, score]) =>
      [
        code,
        Math.max(0, Math.min(1, score)) +
          (sharedModelScores.get(code) ?? 0) * modelEvidenceWeight +
          (calibrated
            ? (LANGUAGE_CANDIDATE_SCORE_BIASES[identity(code)] ?? 0) +
              (lexicalScores.get(identity(code)) ?? 0)
            : 0),
      ] as const,
  );
  const maximum = Math.max(...adjusted.map(([, score]) => score), 1);
  const scores = new Map<string, number>();
  const codes = new Map<string, string>();
  const densities = new Map<string, number>();
  for (const [code, adjustedScore] of adjusted) {
    const key = identity(code);
    const bounded = Math.max(0, Math.min(1, adjustedScore - maximum + 1));
    if (!scores.has(key) || bounded > scores.get(key)!) {
      scores.set(key, bounded);
      codes.set(key, code);
      densities.set(key, (model.scores.get(code) ?? 0) / Math.max(1, model.observed));
    }
  }
  const leader = [...scores].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
  const code = codes.get(leader) ?? "und";
  return {
    weight: letters(text),
    leader,
    code,
    scores,
    codes,
    densities,
  };
}
function assignEvidence(
  text: string,
  result: Classification,
  parameters: LanguageDetectionParameters,
  context: Classification,
): Omit<LanguageEvidenceDecision, "start" | "end"> {
  const value = evidence(text);
  const decision = {
    letters: value.count,
    localLeader: result.leader,
    contextLeader: context.leader,
    modelCode: result.code,
    language: null,
    margin: 0,
    coverage: 0,
    density: 0,
  };
  if (value.count < parameters.minimumSegmentLetters) return { ...decision, reason: "letters" };
  if (value.unique < (result.scores.size === 1 ? 2 : 5))
    return { ...decision, reason: "diversity" };
  if (value.properNames) return { ...decision, reason: "proper-names" };
  if (value.romaji) return { ...decision, reason: "romanized" };
  if (value.rhythmic) return { ...decision, reason: "rhythmic" };
  if (value.fabricated) return { ...decision, reason: "fabricated" };
  const local = [...result.scores].sort((left, right) => right[1] - left[1]);
  const contextWeight =
    value.count >= 35 &&
    local.length > 1 &&
    (local[0]![1] - local[1]![1]) * value.count >= parameters.independentEvidence
      ? 0
      : parameters.contextWeight;
  const ranked = [...result.scores]
    .map(
      ([language, score]) =>
        [
          language,
          context.scores.has(language)
            ? score * (1 - contextWeight) + context.scores.get(language)! * contextWeight
            : score,
        ] as const,
    )
    .sort((left, right) => right[1] - left[1]);
  const first = ranked[0];
  if (!first) return { ...decision, reason: "unsupported" };
  const code = result.codes.get(first[0]) ?? result.code;
  const scored = {
    ...decision,
    modelCode: code,
    margin: first[1] - (ranked[1]?.[1] ?? first[1]),
    coverage: modelCoverage(text, code),
    density: (contextWeight > 0 ? context.densities : result.densities).get(first[0]) ?? 0,
  };
  if (scored.density < (LANGUAGE_CANDIDATE_MINIMUM_MODEL_DENSITY[first[0]] ?? 0))
    return { ...scored, reason: "model-fit" };
  if (scored.coverage < parameters.minimumModelCoverage) return { ...scored, reason: "coverage" };
  if (ranked.length === 1) {
    const supported = value.counts.get(code) ?? 0;
    const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    if (
      supported < parameters.minimumSegmentLetters ||
      value.unique < 2 ||
      (code === "cmn" && kana > 0) ||
      (code === "jpn" && kana < 1)
    )
      return { ...scored, reason: "single-model" };
  } else if (
    first[1] - ranked[1]![1] <
    ((contextWeight > 0 ? context.weight : value.count) < 200
      ? parameters.shortMargin
      : parameters.longMargin)
  )
    return { ...scored, reason: "margin" };
  return { ...scored, language: first[0], reason: "assigned" };
}
const evidenceScripts = Object.entries(scriptExpressions)
  .filter(([script]) => script !== "cmn")
  .map(([script, expression]) => [script, new RegExp(expression.source, "u")] as const);
function scriptFamily(character: string): string {
  for (const [script, expression] of evidenceScripts) if (expression.test(character)) return script;
  return "other";
}
function evidenceIntervals(
  text: string,
  start: number,
  end: number,
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  let from = start;
  let family = "";
  for (let offset = start; offset < end;) {
    const character = String.fromCodePoint(text.codePointAt(offset)!);
    if (character === "\n") {
      if (from < offset) result.push({ start: from, end: offset });
      from = offset + 1;
      family = "";
    }
    if (/\p{L}/u.test(character)) {
      const next = scriptFamily(character);
      if (family && family !== next) {
        result.push({ start: from, end: offset });
        from = offset;
      }
      family = next;
    }
    offset += character.length;
  }
  if (from < end) result.push({ start: from, end });
  return result;
}
export function* createLanguageDetectionWork(
  cues: readonly SubtitleCue[],
  options: LanguageDetectionOptions = {},
): Generator<LanguageDetectionStep, LanguageDetectionResult> {
  try {
    const sample = yield* sampleWork(cues);
    const parameters = options.parameters ?? LANGUAGE_DETECTION_PARAMETERS;
    const total = evidence(sample.text);
    const minimum = Math.min(parameters.minimumLatinLetters, parameters.minimumOtherLetters);
    if (total.count < minimum || total.unique < 8) return unknown("insufficient-evidence");
    const weights = new Map<string, number>();
    const minimums = new Map<string, number>();
    let available = false;
    let offset = 0;
    let fragmentIndex = 0;
    for (const fragment of fragments(sample)) {
      const end = offset + fragment.length;
      const context = classify(
        fragment,
        options.classifier ?? classifyWithFranc,
        parameters.modelEvidenceWeight,
      );
      yield {
        phase: "classifying",
        fragment: fragmentIndex,
        processedCues: 0,
        processedCodeUnits: fragment.length,
      };
      for (const interval of sample.intervals) {
        for (const part of evidenceIntervals(
          sample.text,
          Math.max(offset, interval.start),
          Math.min(end, interval.end),
        )) {
          const text = sample.text.slice(part.start, part.end);
          const result = classify(
            text,
            options.classifier ?? classifyWithFranc,
            parameters.modelEvidenceWeight,
          );
          available ||= result.scores.size > 0;
          const assignment = assignEvidence(text, result, parameters, context);
          const language = assignment.language;
          if (language) {
            weights.set(language, (weights.get(language) ?? 0) + result.weight);
            minimums.set(
              language,
              evidence(text).latin >= 0.5
                ? parameters.minimumLatinLetters
                : parameters.minimumOtherLetters,
            );
          }
          yield {
            phase: "classifying",
            fragment: fragmentIndex,
            processedCues: 0,
            processedCodeUnits: text.length,
            evidence: { ...part, ...assignment },
          };
        }
      }
      offset = end;
      fragmentIndex++;
    }
    const ranked = [...weights].sort((a, b) => b[1] - a[1]);
    const first = ranked[0];
    if (!first) return unknown(available ? "ambiguous" : "unsupported");
    if (first[1] < (minimums.get(first[0]) ?? minimum)) return unknown("insufficient-evidence");
    if (ranked[1]?.[1] === first[1]) return unknown("ambiguous");
    if (first[0].startsWith("model:")) return unknown("unmapped");
    return { state: "reliable", languageId: first[0] };
  } catch {
    return unknown("error");
  }
}
function classifyWithFranc(text: string): Array<[string, number]> {
  return francAll(text, { minLength: 1 });
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
