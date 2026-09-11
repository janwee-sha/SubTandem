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
    | "unsupported"
    | "coverage"
    | "single-model"
    | "margin";
  readonly margin: number;
  readonly coverage: number;
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
}
export const LANGUAGE_DETECTION_PARAMETERS: LanguageDetectionParameters = Object.freeze({
  minimumLatinLetters: 65,
  minimumOtherLetters: 18,
  shortMargin: 0.001,
  longMargin: 0.0001,
  minimumSegmentLetters: 3,
  contextWeight: 1,
  minimumModelCoverage: 0.2,
  independentEvidence: 3,
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
}
const modelTrigrams = new Map<string, Set<string> | null>();
function modelFor(code: string): Set<string> | null {
  if (!modelTrigrams.has(code)) {
    const models = Object.values(modelData).flatMap((group) => (group[code] ? [group[code]!] : []));
    modelTrigrams.set(code, models.length ? new Set(models.join("|").split("|")) : null);
  }
  return modelTrigrams.get(code) ?? null;
}
function modelCoverage(text: string, code: string): number {
  const model = modelFor(code);
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
  const codes = new Map<string, string>();
  for (const [code, score] of candidates) {
    const key = identity(code);
    const bounded = Math.max(0, Math.min(1, score));
    if (!scores.has(key) || bounded > scores.get(key)!) {
      scores.set(key, bounded);
      codes.set(key, code);
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
  };
  if (value.count < parameters.minimumSegmentLetters) return { ...decision, reason: "letters" };
  if (value.unique < (result.scores.size === 1 ? 2 : 5))
    return { ...decision, reason: "diversity" };
  if (value.properNames) return { ...decision, reason: "proper-names" };
  if (value.romaji) return { ...decision, reason: "romanized" };
  if (value.rhythmic) return { ...decision, reason: "rhythmic" };
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
  };
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
      const context = classify(fragment, options.classifier ?? classifyWithFranc);
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
          const result = classify(text, options.classifier ?? classifyWithFranc);
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
