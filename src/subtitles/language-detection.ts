import { data } from "franc-all/data.js";
import { queryLanguageModel } from "./language-model.js";
import { getSourceLanguage, SOURCE_DETECTOR_CODES } from "../domain/source-languages.js";
import type { SubtitleCue } from "./types.js";

export type LanguageDetectionResult =
  | { readonly state: "reliable"; readonly languageId: string }
  | { readonly state: "unknown" }
  | { readonly state: "unsupported" };

export interface LanguageDetectionParameters {
  readonly totalLetterBudget: number;
  readonly spanLetterBudget: number;
  readonly contextLimit: number;
  readonly unsupportedMargin: number;
  readonly minLength: 0;
}

export const DEFAULT_DETECTION_PARAMETERS: LanguageDetectionParameters = Object.freeze({
  totalLetterBudget: 4096,
  spanLetterBudget: 256,
  contextLimit: 512,
  unsupportedMargin: 0.02,
  minLength: 0,
});

export interface LanguageDetectionOptions {
  readonly parameters?: LanguageDetectionParameters;
  readonly classifier?: (
    text: string,
    options: { only?: string[]; minLength: 0 },
  ) => Array<[string, number]>;
}

export interface LanguageDetectionStep {
  readonly phase: "scan" | "sample" | "classify" | "aggregate";
}

export interface LanguageDetectionWork {
  next(): IteratorResult<LanguageDetectionStep, LanguageDetectionResult>;
  dispose(): void;
}

interface TextBlock {
  text: string;
  positions: number[];
  firstLetter: number;
}

interface DetectionSpan {
  start: number;
  end: number;
  represented: number;
}

const LETTER = /\p{L}/u;
const SPACE = /\s/u;
const UNSUPPORTED_SCRIPT =
  /[\p{Script=Armenian}\p{Script=Georgian}\p{Script=Khmer}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Canadian_Aboriginal}\p{Script=Hebrew}]/u;
const SIMPLIFIED = new Set(
  Array.from(
    "发为体国门东车书网头软这来统数语说动种对学习岁细亿继续阳开关见时话汉风电听读写认让过还进连从众应当将业变实总无长",
  ),
);
const TRADITIONAL = new Set(
  Array.from(
    "發為體國門東車書網頭髮軟臺這來統數語說動種對學習歲細億繼續陽開關見時話漢風電聽讀寫認讓過還進連從眾應當將業變實總無長",
  ),
);

function bounded(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
  return text.slice(0, end);
}

function chineseForm(simplified: Set<string>, traditional: Set<string>): string {
  if (simplified.size >= 3 && traditional.size === 0) return "zh-Hans";
  if (traditional.size >= 3 && simplified.size === 0) return "zh-Hant";
  return "zh";
}

export function createLanguageDetectionWork(
  cues: readonly SubtitleCue[],
  options: LanguageDetectionOptions = {},
): LanguageDetectionWork {
  const parameters = options.parameters ?? DEFAULT_DETECTION_PARAMETERS;
  const classifier = options.classifier ?? queryLanguageModel;
  const blocks: TextBlock[] = [];
  const spans: DetectionSpan[] = [];
  const weights = new Map<string, number>();
  const outsideWeights = new Map<string, number>();
  const wordBoundaries: number[] = [];
  const sentenceBoundaries: number[] = [];
  const scriptBoundaries: number[] = [];
  const wordModels = new Map<string, Set<string>>();
  const queries = new Map<string, Array<[string, number]>>();
  const simplified = new Set<string>();
  const traditional = new Set<string>();
  let letterCount = 0;
  let missingWeight = 0;
  let unassignedOutside = 0;
  let disposed = false;

  const clear = (): void => {
    cues = [];
    blocks.length = 0;
    spans.length = 0;
    weights.clear();
    outsideWeights.clear();
    wordBoundaries.length = 0;
    sentenceBoundaries.length = 0;
    scriptBoundaries.length = 0;
    wordModels.clear();
    queries.clear();
    simplified.clear();
    traditional.clear();
  };

  const blockAt = (position: number): TextBlock => {
    let low = 0;
    let high = blocks.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (blocks[middle]!.firstLetter <= position) low = middle;
      else high = middle - 1;
    }
    return blocks[low]!;
  };

  const extract = (start: number, end: number, limit = parameters.contextLimit): string => {
    if (start >= end || !blocks.length) return "";
    const first = blockAt(start);
    const firstIndex = blocks.indexOf(first);
    const result: string[] = [];
    let remaining = limit;
    for (let index = firstIndex; index < blocks.length && remaining > 0; index += 1) {
      const block = blocks[index]!;
      if (block.firstLetter >= end) break;
      const from = block === first ? block.positions[start - block.firstLetter]! : 0;
      const last = end - block.firstLetter;
      const to = last < block.positions.length ? block.positions[last]! : block.text.length;
      const part = bounded(block.text.slice(from, Math.min(to, from + remaining)), remaining);
      result.push(part);
      remaining -= part.length;
    }
    return result.join("").normalize("NFC").trim();
  };

  const query = (text: string, supported: boolean): Array<[string, number]> => {
    const input = bounded(text, Math.min(2048, parameters.contextLimit));
    const key = `${supported ? "supported" : "full"}:${input}`;
    const cached = queries.get(key);
    if (cached) return cached;
    if (supported && !options.classifier) {
      const result = query(input, false).filter(([code]) => getSourceLanguage(code));
      queries.set(key, result);
      return result;
    }
    const result = classifier(input, {
      minLength: 0,
      ...(supported ? { only: SOURCE_DETECTOR_CODES } : {}),
    }).filter(([code, score]) => code !== "und" && Number.isFinite(score));
    queries.set(key, result);
    return result;
  };

  const add = (language: string, count: number, text: string): void => {
    weights.set(language, (weights.get(language) ?? 0) + count);
    if (language === "zh") {
      for (const character of text) {
        if (SIMPLIFIED.has(character)) simplified.add(character);
        if (TRADITIONAL.has(character)) traditional.add(character);
      }
    }
  };

  const boundaryBefore = (boundaries: readonly number[], end: number): number => {
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (boundaries[middle]! <= end) low = middle + 1;
      else high = middle;
    }
    return boundaries[low - 1] ?? 0;
  };

  const nextBoundary = (boundaries: readonly number[], start: number): number => {
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (boundaries[middle]! <= start) low = middle + 1;
      else high = middle;
    }
    return boundaries[low] ?? letterCount;
  };

  const modelWords = (code: string): Set<string> => {
    let model = wordModels.get(code);
    if (!model) {
      const values = Object.values(data).find((models) => code in models)?.[code];
      model = new Set(values?.split("|") ?? []);
      wordModels.set(code, model);
    }
    return model;
  };

  const outsideIdentity = (code: string): string =>
    code === "nob" || code === "nno" ? "no" : code;

  function* run(): Generator<LanguageDetectionStep, LanguageDetectionResult, void> {
    try {
      let cueIndex = 0;
      let offset = 0;
      let markup: string | null = null;
      let url = false;
      let space = true;
      let carry = "";
      let previousOutsideScript: boolean | null = null;
      while (cueIndex < cues.length || carry) {
        const characters: string[] = [];
        let consumed = 0;
        while (cueIndex < cues.length && consumed < 8192) {
          const raw = cues[cueIndex]!.normalizedText;
          if (offset >= raw.length) {
            cueIndex += 1;
            offset = 0;
            consumed += 1;
            url = false;
            markup = null;
            if (!space) characters.push(" ");
            space = true;
            continue;
          }
          const character = String.fromCodePoint(raw.codePointAt(offset)!);
          if (markup) {
            if (character === markup) markup = null;
          } else if (url && !SPACE.test(character) && character !== "<" && character !== ">") {
            offset += character.length;
            consumed += character.length;
            continue;
          } else if (character === "{" || character === "<") {
            markup = character === "{" ? "}" : ">";
          } else if (
            (character === "h" || character === "H" || character === "w" || character === "W") &&
            /^(?:https?:\/\/|www\.)/i.test(raw.slice(offset, offset + 8))
          ) {
            url = true;
          } else if (SPACE.test(character)) {
            url = false;
            if (!space) characters.push(" ");
            space = true;
          } else {
            url = false;
            characters.push(character);
            space = false;
          }
          offset += character.length;
          consumed += character.length;
        }
        let text = (carry + characters.join("")).normalize("NFC");
        carry = "";
        if (cueIndex < cues.length) {
          const tail = text.match(/[^\p{M}]\p{M}*$/u)?.[0] ?? "";
          if (tail.length < 8192) {
            carry = tail;
            text = text.slice(0, text.length - tail.length);
          }
        }
        if (text) {
          const positions = Array.from(text.matchAll(/\p{L}/gu), (match) => match.index);
          if (positions.length) {
            for (const [index, position] of positions.entries()) {
              const character = String.fromCodePoint(text.codePointAt(position)!);
              const outside = character.charCodeAt(0) >= 128 && UNSUPPORTED_SCRIPT.test(character);
              if (previousOutsideScript !== null && outside !== previousOutsideScript)
                scriptBoundaries.push(letterCount + index);
              previousOutsideScript = outside;
            }
            let position = 0;
            for (const boundary of text.matchAll(/\s+|[.!?。！？:;]/gu)) {
              while (position < positions.length && positions[position]! < boundary.index)
                position += 1;
              const count = letterCount + position;
              if (wordBoundaries[wordBoundaries.length - 1] !== count) wordBoundaries.push(count);
              if (
                !SPACE.test(boundary[0]) &&
                sentenceBoundaries[sentenceBoundaries.length - 1] !== count
              )
                sentenceBoundaries.push(count);
            }
            blocks.push({ text, positions, firstLetter: letterCount });
            letterCount += positions.length;
          } else if (blocks.length) {
            blocks[blocks.length - 1]!.text += bounded(text, 1);
          }
        }
        yield { phase: "scan" };
      }
      if (!letterCount) return { state: "unknown" };
      const sampled = letterCount > parameters.totalLetterBudget;
      if (sampled) {
        const count = Math.min(64, Math.ceil(letterCount / parameters.spanLetterBudget));
        for (let index = 0; index < count; index += 1) {
          const first = Math.floor((letterCount * index) / count);
          const last = Math.floor((letterCount * (index + 1)) / count);
          const length = Math.min(last - first, Math.floor(parameters.totalLetterBudget / count));
          const center = first + Math.floor((last - first - length) / 2);
          const start = Math.max(first, boundaryBefore(wordBoundaries, center));
          const observed = extract(start, start + length).match(/\p{L}/gu)?.length ?? 0;
          spans.push({ start, end: start + observed, represented: last - first });
        }
      } else {
        let start = 0;
        while (start < letterCount) {
          const limit = Math.min(letterCount, start + parameters.spanLetterBudget);
          const sentence = boundaryBefore(sentenceBoundaries, limit);
          const word = boundaryBefore(wordBoundaries, limit);
          const proposedEnd = Math.min(
            nextBoundary(scriptBoundaries, start),
            sentence > start ? sentence : word > start ? word : limit,
          );
          const observed = extract(start, proposedEnd).match(/\p{L}/gu)?.length ?? 0;
          const end = start + observed;
          if (end <= start) return { state: "unknown" };
          spans.push({ start, end, represented: end - start });
          start = end;
        }
      }
      yield { phase: "sample" };
      for (const span of spans) {
        let text = extract(span.start, span.end);
        let full = query(text, false);
        const clauseStart =
          span.start === 0 || boundaryBefore(sentenceBoundaries, span.start) === span.start;
        const word = clauseStart
          ? text.match(/^\p{Script=Latin}[\p{Script=Latin}\p{M}]*/u)?.[0]
          : undefined;
        if (word && word === word.toLowerCase() && full[0] && !getSourceLanguage(full[0][0])) {
          const padded = ` ${word.toLowerCase()} `;
          const trigrams = Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
            padded.slice(index, index + 3),
          );
          if (
            trigrams.length &&
            !trigrams.every((trigram) => modelWords(full[0]![0]).has(trigram))
          ) {
            const candidate = query(word, true)[0];
            if (
              candidate &&
              getSourceLanguage(candidate[0]) &&
              trigrams.every((trigram) => modelWords(candidate[0]).has(trigram))
            ) {
              const length = word.match(/\p{L}/gu)?.length ?? 0;
              const represented = (span.represented * length) / (span.end - span.start);
              add(getSourceLanguage(candidate[0])!.languageId, represented, word);
              span.start += length;
              span.represented -= represented;
              if (span.start === span.end) {
                yield { phase: "classify" };
                continue;
              }
              text = extract(span.start, span.end);
              full = query(text, false);
            }
          }
        }
        const local = query(text, true);
        const radius = Math.floor(
          (parameters.contextLimit - Math.min(parameters.contextLimit, text.length)) / 4,
        );
        const context = extract(
          Math.max(0, span.start - radius),
          Math.min(letterCount, span.end + radius),
        );
        const contextual = context === text ? full : query(context, false);
        if (
          span.end - span.start < parameters.spanLetterBudget / 4 &&
          full[0] &&
          !getSourceLanguage(full[0][0]) &&
          context !== text
        ) {
          const localContext = extract(
            Math.max(0, span.start - Math.floor(radius / 2)),
            Math.min(letterCount, span.end + Math.floor(radius / 2)),
          );
          if (localContext !== text) full = query(localContext, false);
        }
        const first = full[0];
        const outside = first && !getSourceLanguage(first[0]);
        const inScopeScore = full.find(([code]) => getSourceLanguage(code))?.[1] ?? 0;
        const letters = Array.from(text).filter((character) => LETTER.test(character));
        const exclusiveScript =
          letters.length > 0 && letters.every((character) => UNSUPPORTED_SCRIPT.test(character));
        if (
          exclusiveScript ||
          (outside &&
            context !== text &&
            contextual[0] &&
            outsideIdentity(contextual[0][0]) === outsideIdentity(first[0]) &&
            first[1] - inScopeScore >= parameters.unsupportedMargin)
        ) {
          if (outside)
            outsideWeights.set(
              outsideIdentity(first[0]),
              (outsideWeights.get(outsideIdentity(first[0])) ?? 0) + span.represented,
            );
          else unassignedOutside += span.represented;
        } else {
          let selected = local.find(([code]) => getSourceLanguage(code));
          if (
            selected &&
            span.end - span.start < parameters.spanLetterBudget / 4 &&
            contextual[0] &&
            getSourceLanguage(contextual[0][0])
          )
            selected = contextual[0];
          if (selected) add(getSourceLanguage(selected[0])!.languageId, span.represented, text);
          else missingWeight += span.represented;
        }
        yield { phase: "classify" };
      }
      if (missingWeight) {
        const fallback = query(extract(0, letterCount), true).find(([code]) =>
          getSourceLanguage(code),
        );
        if (fallback) add(getSourceLanguage(fallback[0])!.languageId, missingWeight, "");
        yield { phase: "classify" };
      }
      let selected: string | null = null;
      let maximum = -1;
      for (const [language, count] of weights) {
        if (count > maximum || (count === maximum && selected !== null && language < selected)) {
          selected = language;
          maximum = count;
        }
      }
      yield { phase: "aggregate" };
      if (selected)
        return {
          state: "reliable",
          languageId: selected === "zh" ? chineseForm(simplified, traditional) : selected,
        };
      const outsideTotal = [...outsideWeights.values()].reduce(
        (sum, count) => sum + count,
        unassignedOutside,
      );
      return outsideTotal === letterCount ? { state: "unsupported" } : { state: "unknown" };
    } catch {
      return { state: "unknown" };
    } finally {
      clear();
    }
  }

  const iterator = run();
  return {
    next: () => (disposed ? { done: true, value: { state: "unknown" } } : iterator.next()),
    dispose: () => {
      disposed = true;
      iterator.return({ state: "unknown" });
      clear();
    },
  };
}

export function detectSubtitleLanguage(
  cues: readonly SubtitleCue[],
  options: LanguageDetectionOptions = {},
): LanguageDetectionResult {
  const work = createLanguageDetectionWork(cues, options);
  try {
    let next = work.next();
    while (!next.done) next = work.next();
    return next.value;
  } finally {
    work.dispose();
  }
}
