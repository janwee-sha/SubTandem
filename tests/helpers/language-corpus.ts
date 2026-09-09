import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSubtitleSource } from "../../src/subtitles/source.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";
import {
  DEFAULT_DETECTION_PARAMETERS,
  type LanguageDetectionResult,
} from "../../src/subtitles/language-detection.js";

export type CorpusSplit = "calibration" | "acceptance";
export type Outcome = "correct" | "incorrect" | "unknown" | "unsupported";

export const SOURCE_LANGUAGE_IDS = new Set(
  "am ar az be bg bho bn bs ceb cs de el en es fa fil fr gu ha hi hmn hr hu id ig it ja jv kk kn ko ku ln mg ml mr ms my ne nl ny pa pl ps pt qu rn ro ru rw si so sr su sv sw ta te th tr uk ur uz vi yo zh zu".split(
    " ",
  ),
);

export const REQUIRED_CONTENT_TAGS = [
  "romanized-japanese",
  "natural-hausa",
  "natural-mixed",
  "shared-script",
  "short-phrases-names",
  "credits",
  "repeated-lyrics",
  "majority",
  "40-35-25",
  "supported-tie",
  "unsupported-majority",
  "unsupported-combined-majority",
  "small-supported-share",
  "supported-unsupported-tie",
  "cue-weight-conflict",
  "duration-weight-conflict",
  "within-cue-mixed",
  "across-cue-mixed",
  "clustered",
  "interleaved",
  "over-sampling-budget",
  "zh-Hans",
  "zh-Hant",
  "zh-unspecified",
  "zh-conflicting-forms",
  "zh-with-kana",
  "one-to-four-cues",
  "sparse-letters",
  "no-letters",
  "unsupported-fi",
  "unsupported-he",
  "unsupported-no",
  "unsupported-other",
  "unsupported-mixed",
  "german-eleven",
  "english-ass",
  "hungarian-nineteen",
  "italian-nineteen",
  "russian-nineteen",
  "swedish-nineteen",
  "five-six-latin",
  "five-six-distinct-script",
  "segmentation",
  "duration",
  "format",
] as const;

export interface SourceRecord {
  sourceId: string;
  workId: string;
  lineageIds: string[];
  url: string;
  revision: string;
  authors: string[];
  translators: string[];
  file: string;
  sha256: string;
  license: string;
  licenseUrl: string;
  licenseFile: string;
  licenseSha256: string;
  attribution: string;
  acquiredAt: string;
  redistributionVerifiedBy: string;
}

export interface SourceGroup {
  groupId: string;
  sourceIds: string[];
  lineageIds: string[];
  split: CorpusSplit;
}

export interface GroundTruth {
  spans: Array<{ startLetter: number; endLetter: number; languageId: string | null }>;
  languageLetters: Record<string, number>;
  chineseForm: "zh" | "zh-Hans" | "zh-Hant" | null;
  expectedLanguageIds: string[];
  sufficient: boolean;
  positive: boolean;
  behavior: "candidate" | "unknown" | "unsupported";
  reviewedBy: string;
  reviewedAt: string;
  evidence: string[];
  naturalnessEvidence: string;
}

export interface SubtitleSample {
  sampleId: string;
  groupId: string;
  file: string;
  sha256: string;
  normalizedSha256: string;
  originalRanges: Array<{ sourceId: string; startCue: number; endCue: number }>;
  originalCueCount: number;
  effectiveLetterCount: number;
  format: "srt" | "ass" | "ssa";
  tags: string[];
  statisticalUnitId: string;
  kind: "natural" | "variant" | "controlled-mix" | "synthetic";
  derivedFrom: string[];
  truth: GroundTruth;
}

export interface CorpusManifest {
  schemaVersion: 1;
  version: string;
  split: CorpusSplit;
  sources: SourceRecord[];
  groups: SourceGroup[];
  samples: SubtitleSample[];
  units: Array<{ statisticalUnitId: string; primarySampleId: string; sampleIds: string[] }>;
}

export interface LoadedSample extends SubtitleSample {
  bytes: Uint8Array;
  cues: SubtitleCue[];
  primary: boolean;
}

export interface LoadedCorpus {
  manifest: CorpusManifest;
  samples: LoadedSample[];
  hashes: Record<"sources" | "groups" | "samples" | "truth" | "strata" | "units", string>;
}

export const corpusRoot = fileURLToPath(new URL("../fixtures/languages/", import.meta.url));

function requireValue(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`LANGUAGE_CORPUS_${code}`);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonempty);
}

function date(value: unknown): boolean {
  return nonempty(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

function url(value: unknown): boolean {
  if (!nonempty(value)) return false;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function corpusHash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function objectHash(value: unknown): string {
  return corpusHash(stable(value));
}

function read(root: string, file: string): Uint8Array {
  requireValue(nonempty(file) && !isAbsolute(file), "INVALID_FILE");
  try {
    const target = realpathSync(resolve(root, file));
    const local = relative(realpathSync(root), target);
    requireValue(local !== ".." && !local.startsWith("../") && !isAbsolute(local), "INVALID_FILE");
    return readFileSync(target);
  } catch {
    throw new Error("LANGUAGE_CORPUS_FILE_UNAVAILABLE");
  }
}

function json<T>(root: string, file: string): T {
  try {
    return JSON.parse(Buffer.from(read(root, file)).toString("utf8")) as T;
  } catch {
    throw new Error("LANGUAGE_CORPUS_MANIFEST_UNAVAILABLE");
  }
}

function verifiedFile(root: string, file: string, hash: string): Uint8Array {
  const bytes = read(root, file);
  requireValue(/^[a-f0-9]{64}$/.test(hash) && corpusHash(bytes) === hash, "FILE_HASH_MISMATCH");
  return bytes;
}

export function normalizedCorpusText(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue) => cue.normalizedText)
    .join("\n")
    .normalize("NFC")
    .replace(/\{[^}]*\}|<[^>]*>/g, "")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function letters(text: string): string {
  return (text.match(/\p{L}/gu) ?? []).join("");
}

function parsed(bytes: Uint8Array, format: string): SubtitleCue[] {
  const result = loadSubtitleSource({ id: 1, isExternal: true, title: `corpus.${format}` }, bytes);
  requireValue(result.ok, "SUBTITLE_PARSE_FAILED");
  return result.source.cues;
}

function unique<T>(items: readonly T[], key: (item: T) => string, code: string): Map<string, T> {
  requireValue(Array.isArray(items), code);
  const map = new Map(items.map((item) => [key(item), item]));
  requireValue(map.size === items.length && [...map.keys()].every(nonempty), code);
  return map;
}

function baseLanguage(id: string): string {
  return id.startsWith("zh-") ? "zh" : id;
}

function verifyTruth(sample: SubtitleSample, requireReviewed: boolean): void {
  const truth = sample.truth;
  requireValue(
    truth &&
      (!requireReviewed || (nonempty(truth.reviewedBy) && date(truth.reviewedAt))) &&
      strings(truth.evidence) &&
      nonempty(truth.naturalnessEvidence),
    "TRUTH_NOT_REVIEWED",
  );
  requireValue(
    typeof truth.positive === "boolean" &&
      typeof truth.sufficient === "boolean" &&
      [null, "zh", "zh-Hans", "zh-Hant"].includes(truth.chineseForm),
    "INVALID_TRUTH",
  );
  const counts: Record<string, number> = {};
  let cursor = 0;
  requireValue(Array.isArray(truth.spans), "INVALID_SPANS");
  for (const span of truth.spans) {
    requireValue(
      Number.isInteger(span.startLetter) &&
        Number.isInteger(span.endLetter) &&
        span.startLetter === cursor &&
        span.endLetter > cursor &&
        span.endLetter <= sample.effectiveLetterCount &&
        (span.languageId === null || /^[a-z]{2,3}$/.test(span.languageId)),
      "INVALID_SPANS",
    );
    const id = span.languageId ?? "unassigned";
    counts[id] = (counts[id] ?? 0) + span.endLetter - span.startLetter;
    cursor = span.endLetter;
  }
  requireValue(
    cursor === sample.effectiveLetterCount && stable(counts) === stable(truth.languageLetters),
    "TRUTH_LETTER_MISMATCH",
  );
  const supported = Object.entries(counts).filter(([id]) => SOURCE_LANGUAGE_IDS.has(id));
  const maximum = Math.max(0, ...supported.map(([, count]) => count));
  const expected = supported
    .filter(([, count]) => count === maximum)
    .map(([id]) => (id === "zh" ? (truth.chineseForm ?? "zh") : id))
    .sort();
  requireValue(
    Array.isArray(truth.expectedLanguageIds) &&
      stable([...truth.expectedLanguageIds].sort()) === stable(expected),
    "EXPECTED_LANGUAGE_MISMATCH",
  );
  requireValue(
    ["candidate", "unknown", "unsupported"].includes(truth.behavior),
    "INVALID_BEHAVIOR",
  );
  requireValue(
    expected.length > 0 ? truth.behavior === "candidate" : truth.behavior !== "candidate",
    "INVALID_BEHAVIOR",
  );
  requireValue(
    truth.behavior !== "unsupported" || (cursor > 0 && !counts.unassigned),
    "UNCONFIRMED_UNSUPPORTED",
  );
  requireValue(
    !truth.positive || (truth.sufficient && expected.length > 0 && !counts.unassigned),
    "INVALID_POSITIVE",
  );
}

function readCorpus(split: CorpusSplit, root: string, requireReviewed: boolean): LoadedCorpus {
  const manifest = json<CorpusManifest>(root, `${split}.json`);
  requireValue(
    manifest?.schemaVersion === 1 &&
      manifest.split === split &&
      nonempty(manifest.version) &&
      !("cycles" in manifest) &&
      !("languages" in manifest),
    "NATURAL_MANIFEST_REQUIRED",
  );
  const sources = unique(manifest.sources, (source) => source.sourceId, "DUPLICATE_SOURCE");
  const groups = unique(manifest.groups, (group) => group.groupId, "DUPLICATE_GROUP");
  const samples = unique(manifest.samples, (sample) => sample.sampleId, "DUPLICATE_SAMPLE");
  const units = unique(manifest.units, (unit) => unit.statisticalUnitId, "DUPLICATE_UNIT");
  const sourceCues = new Map<string, SubtitleCue[]>();
  for (const source of sources.values()) {
    requireValue(
      nonempty(source.workId) &&
        strings(source.lineageIds) &&
        url(source.url) &&
        nonempty(source.revision) &&
        strings(source.authors) &&
        strings(source.translators) &&
        nonempty(source.license) &&
        url(source.licenseUrl) &&
        nonempty(source.attribution) &&
        date(source.acquiredAt) &&
        nonempty(source.redistributionVerifiedBy),
      "SOURCE_NOT_ADMITTED",
    );
    verifiedFile(root, source.licenseFile, source.licenseSha256);
    const bytes = verifiedFile(root, source.file, source.sha256);
    sourceCues.set(source.sourceId, parsed(bytes, source.file.split(".").pop() ?? "srt"));
  }
  for (const group of groups.values()) {
    requireValue(
      group.split === split &&
        strings(group.sourceIds) &&
        strings(group.lineageIds) &&
        new Set(group.sourceIds).size === group.sourceIds.length &&
        group.sourceIds.every((id) => sources.has(id)),
      "INVALID_GROUP",
    );
    for (const id of group.sourceIds) {
      const source = sources.get(id)!;
      requireValue(
        [source.workId, ...source.lineageIds].every((lineage) =>
          group.lineageIds.includes(lineage),
        ),
        "MISSING_LINEAGE",
      );
    }
  }
  for (const source of sources.values())
    requireValue(
      manifest.groups.filter((group) => group.sourceIds.includes(source.sourceId)).length === 1,
      "SOURCE_GROUP_OWNERSHIP",
    );
  for (const unit of units.values()) {
    requireValue(
      strings(unit.sampleIds) &&
        new Set(unit.sampleIds).size === unit.sampleIds.length &&
        unit.sampleIds.includes(unit.primarySampleId),
      "INVALID_UNIT",
    );
    const primary = samples.get(unit.primarySampleId);
    requireValue(
      primary?.kind === "natural" && primary.derivedFrom.length === 0,
      "NATURAL_PRIMARY_REQUIRED",
    );
    requireValue(
      unit.sampleIds.every((id) => samples.get(id)?.statisticalUnitId === unit.statisticalUnitId),
      "UNIT_MEMBERSHIP",
    );
  }
  const primaryHashes = new Set<string>();
  const originalOwnership = new Map<string, string>();
  const workIntervals: Array<{
    workId: string;
    sourceId: string;
    unitId: string;
    start: number;
    end: number;
  }> = [];
  const loaded = manifest.samples.map((sample): LoadedSample => {
    requireValue(
      groups.has(sample.groupId) &&
        ["srt", "ass", "ssa"].includes(sample.format) &&
        ["natural", "variant", "controlled-mix", "synthetic"].includes(sample.kind) &&
        Array.isArray(sample.derivedFrom) &&
        Array.isArray(sample.tags) &&
        sample.tags.every(nonempty),
      "INVALID_SAMPLE",
    );
    const unit = units.get(sample.statisticalUnitId);
    requireValue(unit && unit.sampleIds.includes(sample.sampleId), "MISSING_UNIT");
    const bytes = verifiedFile(root, sample.file, sample.sha256);
    const cues = parsed(bytes, sample.format);
    const text = normalizedCorpusText(cues);
    requireValue(
      corpusHash(text) === sample.normalizedSha256 &&
        cues.length === sample.originalCueCount &&
        Array.from(letters(text)).length === sample.effectiveLetterCount,
      "SAMPLE_CONTENT_MISMATCH",
    );
    verifyTruth(sample, requireReviewed);
    requireValue(
      sample.derivedFrom.every(
        (id) =>
          id !== sample.sampleId && samples.has(id) && samples.get(id)!.groupId === sample.groupId,
      ),
      "INVALID_DERIVATION",
    );
    const ancestors = new Set<string>([sample.sampleId]);
    const visit = (id: string): void => {
      requireValue(!ancestors.has(id), "CYCLIC_DERIVATION");
      ancestors.add(id);
      for (const parent of samples.get(id)!.derivedFrom) visit(parent);
      ancestors.delete(id);
    };
    sample.derivedFrom.forEach(visit);
    requireValue(
      sample.kind === "natural"
        ? sample.derivedFrom.length === 0
        : sample.kind === "synthetic" || sample.derivedFrom.length > 0,
      "MISSING_DERIVATION",
    );
    requireValue(Array.isArray(sample.originalRanges), "MISSING_ORIGINAL_RANGE");
    const original: SubtitleCue[] = [];
    for (const range of sample.originalRanges) {
      const source = sourceCues.get(range.sourceId);
      requireValue(
        source &&
          groups.get(sample.groupId)!.sourceIds.includes(range.sourceId) &&
          Number.isInteger(range.startCue) &&
          Number.isInteger(range.endCue) &&
          range.startCue >= 0 &&
          range.endCue > range.startCue &&
          range.endCue <= source.length,
        "INVALID_ORIGINAL_RANGE",
      );
      original.push(...source.slice(range.startCue, range.endCue));
      if (sample.kind === "natural") {
        const workId = sources.get(range.sourceId)!.workId;
        const interval = {
          workId,
          sourceId: range.sourceId,
          unitId: sample.statisticalUnitId,
          start: source[range.startCue]!.startMs,
          end: source[range.endCue - 1]!.endMs,
        };
        requireValue(
          workIntervals.every(
            (other) =>
              other.workId !== workId ||
              other.sourceId === interval.sourceId ||
              other.unitId === interval.unitId ||
              other.end <= interval.start ||
              interval.end <= other.start,
          ),
          "PARALLEL_TRANSLATION_UNIT_MISMATCH",
        );
        workIntervals.push(interval);
        for (let index = range.startCue; index < range.endCue; index += 1) {
          const key = `${range.sourceId}:${index}`;
          const owner = originalOwnership.get(key);
          requireValue(!owner || owner === sample.statisticalUnitId, "REUSED_NATURAL_CUE");
          originalOwnership.set(key, sample.statisticalUnitId);
        }
      }
    }
    if (sample.kind === "natural") {
      requireValue(
        sample.originalRanges.length === 1 &&
          original.length === cues.length &&
          normalizedCorpusText(original) === text,
        "NATURAL_SOURCE_MISMATCH",
      );
    }
    if (sample.kind === "variant") {
      requireValue(sample.derivedFrom.length === 1, "INVALID_VARIANT");
      const parent = samples.get(sample.derivedFrom[0]!)!;
      requireValue(parent.statisticalUnitId === sample.statisticalUnitId, "VARIANT_UNIT_MISMATCH");
      if (!sample.tags.includes("translation")) {
        const parentCues = parsed(verifiedFile(root, parent.file, parent.sha256), parent.format);
        requireValue(
          letters(normalizedCorpusText(parentCues)) === letters(text),
          "VARIANT_TEXT_MISMATCH",
        );
      }
    }
    const primary = unit.primarySampleId === sample.sampleId;
    if (primary) {
      const fingerprint = corpusHash(letters(text));
      requireValue(!primaryHashes.has(fingerprint), "DUPLICATE_PRIMARY_TEXT");
      primaryHashes.add(fingerprint);
    }
    return { ...sample, bytes, cues, primary };
  });
  return {
    manifest,
    samples: loaded,
    hashes: {
      sources: objectHash(manifest.sources),
      groups: objectHash(manifest.groups),
      samples: objectHash(manifest.samples),
      truth: objectHash(
        manifest.samples.map((sample) => ({ sampleId: sample.sampleId, truth: sample.truth })),
      ),
      strata: objectHash(
        manifest.samples.map((sample) => ({
          sampleId: sample.sampleId,
          tags: sample.tags,
          originalCueCount: sample.originalCueCount,
          positive: sample.truth.positive,
        })),
      ),
      units: objectHash(manifest.units),
    },
  };
}

export function lengthGroup(count: number): "tiny" | "short" | "medium" | "long" {
  return count < 5 ? "tiny" : count < 12 ? "short" : count < 31 ? "medium" : "long";
}

export function loadCorpus(split: CorpusSplit, root = corpusRoot): LoadedCorpus {
  return readCorpus(split, root, true);
}

export function auditCorpusDrafts(root = corpusRoot) {
  const corpora = ["calibration", "acceptance"].map((split) =>
    readCorpus(split as CorpusSplit, root, false),
  );
  verifyCorpusIsolation(corpora[0]!, corpora[1]!);
  return corpora.map((corpus) => {
    const primary = corpus.samples.filter((sample) => sample.primary);
    return {
      split: corpus.manifest.split,
      sources: corpus.manifest.sources.length,
      works: new Set(corpus.manifest.sources.map((source) => source.workId)).size,
      naturalPrimarySamples: primary.length,
      derivedSamples: corpus.samples.length - primary.length,
      proposedPositiveLengths: Object.fromEntries(
        ["tiny", "short", "medium", "long"].map((group) => [
          group,
          primary.filter(
            (sample) => sample.truth.positive && lengthGroup(sample.originalCueCount) === group,
          ).length,
        ]),
      ),
      pendingReview: corpus.samples
        .filter((sample) => !nonempty(sample.truth.reviewedBy) || !date(sample.truth.reviewedAt))
        .map((sample) => sample.sampleId),
      proposedCoverageIssues: coverageIssues(corpus),
    };
  });
}

export function coverageIssues(corpus: LoadedCorpus): string[] {
  const primary = corpus.samples.filter((sample) => sample.primary);
  const positive = primary.filter((sample) => sample.truth.positive);
  const languageCues = new Map<string, Set<string>>();
  for (const sample of primary) {
    for (const id of Object.keys(sample.truth.languageLetters).filter((id) =>
      SOURCE_LANGUAGE_IDS.has(id),
    )) {
      const covered = languageCues.get(id) ?? new Set<string>();
      let position = 0;
      sample.cues.forEach((cue, index) => {
        const end = position + Array.from(letters(normalizedCorpusText([cue]))).length;
        if (
          sample.truth.spans.some(
            (span) => span.languageId === id && span.startLetter < end && span.endLetter > position,
          )
        )
          covered.add(`${sample.sampleId}:${index}`);
        position = end;
      });
      languageCues.set(id, covered);
    }
  }
  const issues: string[] = [];
  const covered = [...languageCues].filter(([, cues]) => cues.size >= 20);
  if (covered.length < 20) issues.push(`languages:${covered.length}/20`);
  for (const id of "en de fr es pt it hu sv ru uk pl cs nl tr ar fa ja ko zh ha".split(" "))
    if ((languageCues.get(id)?.size ?? 0) < 20)
      issues.push(`language:${id}:${languageCues.get(id)?.size ?? 0}/20`);
  for (const group of ["short", "medium", "long"] as const) {
    const count = positive.filter(
      (sample) => lengthGroup(sample.originalCueCount) === group,
    ).length;
    if (count < 20) issues.push(`length:${group}:${count}/20`);
  }
  for (const tag of REQUIRED_CONTENT_TAGS) {
    const pool = ["natural-mixed", "natural-hausa", "romanized-japanese"].includes(tag)
      ? primary
      : corpus.samples;
    if (!pool.some((sample) => sample.tags.includes(tag))) issues.push(`content:${tag}`);
  }
  const regressions: Array<[string, (sample: LoadedSample) => boolean]> = [
    [
      "german-eleven",
      (s) =>
        s.originalCueCount === 11 &&
        s.effectiveLetterCount >= 280 &&
        s.effectiveLetterCount <= 390 &&
        s.truth.expectedLanguageIds.includes("de"),
    ],
    [
      "english-ass",
      (s) =>
        s.originalCueCount >= 36 &&
        s.originalCueCount <= 40 &&
        s.format === "ass" &&
        s.truth.expectedLanguageIds.includes("en"),
    ],
    ...(
      [
        ["hungarian-nineteen", "hu"],
        ["italian-nineteen", "it"],
        ["russian-nineteen", "ru"],
        ["swedish-nineteen", "sv"],
      ] as const
    ).map(([tag, id]): [string, (s: LoadedSample) => boolean] => [
      tag,
      (s) =>
        s.originalCueCount >= 17 &&
        s.originalCueCount <= 21 &&
        s.truth.expectedLanguageIds.includes(id),
    ]),
    [
      "five-six-latin",
      (s) => s.originalCueCount >= 5 && s.originalCueCount <= 6 && s.truth.sufficient,
    ],
    [
      "five-six-distinct-script",
      (s) => s.originalCueCount >= 5 && s.originalCueCount <= 6 && s.truth.sufficient,
    ],
  ];
  for (const [tag, matches] of regressions)
    if (!corpus.samples.some((sample) => sample.tags.includes(tag) && matches(sample)))
      issues.push(`regression:${tag}`);
  return issues;
}

export function verifyCorpusIsolation(left: LoadedCorpus, right: LoadedCorpus): void {
  const identities = (corpus: LoadedCorpus): Set<string> =>
    new Set([
      ...corpus.manifest.sources.flatMap((source) => [
        source.sourceId,
        source.workId,
        source.sha256,
        ...source.lineageIds,
      ]),
      ...corpus.manifest.groups.flatMap((group) => [group.groupId, ...group.lineageIds]),
      ...corpus.manifest.units.map((unit) => unit.statisticalUnitId),
      ...corpus.samples.flatMap((sample) => {
        const text = letters(normalizedCorpusText(sample.cues));
        return [
          sample.sampleId,
          sample.sha256,
          sample.normalizedSha256,
          ...(text ? [corpusHash(text)] : []),
        ];
      }),
    ]);
  const leftIds = identities(left);
  requireValue(
    [...identities(right)].every((id) => !leftIds.has(id)),
    "CROSS_SPLIT_LEAKAGE",
  );
}

export function loadFrozenCorpora(root = corpusRoot): Record<CorpusSplit, LoadedCorpus> {
  const calibration = loadCorpus("calibration", root);
  const acceptance = loadCorpus("acceptance", root);
  verifyCorpusIsolation(calibration, acceptance);
  for (const corpus of [calibration, acceptance]) {
    const issues = coverageIssues(corpus);
    requireValue(
      issues.length === 0,
      `COVERAGE_INCOMPLETE:${corpus.manifest.split}:${issues.join(",")}`,
    );
  }
  const freeze = json<{
    schemaVersion: number;
    version: string;
    status: string;
    reviewedBy: string;
    frozenAt: string;
    splits: Record<CorpusSplit, LoadedCorpus["hashes"]>;
  }>(root, "freeze.json");
  requireValue(
    freeze.schemaVersion === 1 &&
      freeze.status === "frozen" &&
      nonempty(freeze.reviewedBy) &&
      date(freeze.frozenAt) &&
      calibration.manifest.version === freeze.version &&
      acceptance.manifest.version === freeze.version,
    "NOT_FROZEN",
  );
  requireValue(
    stable(freeze.splits) ===
      stable({ calibration: calibration.hashes, acceptance: acceptance.hashes }),
    "FREEZE_HASH_MISMATCH",
  );
  return { calibration, acceptance };
}

export const DETECTOR_SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "src/subtitles/language-detection.ts",
  "src/subtitles/language-model.ts",
  "src/app/language-detection.ts",
  "src/main.ts",
  "src/entry.ts",
  "src/app/controller.ts",
  "src/domain/source-languages.ts",
  "tests/fixtures/languages/freeze.json",
];

export const DETECTOR_MODEL_MODULES = [
  "franc-all",
  "franc-all/data.js",
  "franc-all/expressions.js",
  "trigram-utils",
  "collapse-white-space",
  "n-gram",
];

export function detectorConfigurationFiles(
  project = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
) {
  const require = createRequire(import.meta.url);
  return {
    files: Object.fromEntries(
      DETECTOR_SOURCE_FILES.map((file) => [file, corpusHash(readFileSync(resolve(project, file)))]),
    ),
    models: Object.fromEntries(
      DETECTOR_MODEL_MODULES.map((module) => [
        module,
        corpusHash(readFileSync(require.resolve(module))),
      ]),
    ),
  };
}

export function verifyDetectorConfiguration(root = corpusRoot): string {
  requireValue(existsSync(resolve(root, "detector-config.json")), "CONFIG_NOT_FROZEN");
  const config = json<{
    schemaVersion: number;
    status: string;
    files: Record<string, string>;
    models: Record<string, string>;
    parameters: {
      totalLetterBudget: number;
      spanLetterBudget: number;
      contextLimit: number;
      unsupportedMargin: number;
      minLength: number;
    };
    calibrationReport: string;
    calibrationReportSha256: string;
  }>(root, "detector-config.json");
  const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  requireValue(
    config.schemaVersion === 1 && config.status === "frozen" && config.files,
    "CONFIG_NOT_FROZEN",
  );
  for (const file of DETECTOR_SOURCE_FILES) verifiedFile(project, file, config.files[file]!);
  for (const [file, hash] of Object.entries(config.files)) verifiedFile(project, file, hash);
  requireValue(
    stable(config.models) === stable(detectorConfigurationFiles(project).models),
    "MODEL_HASH_MISMATCH",
  );
  const p = config.parameters;
  requireValue(
    p &&
      [4096, 8192, 16384].includes(p.totalLetterBudget) &&
      [128, 256, 512].includes(p.spanLetterBudget) &&
      [512, 1024, 2048].includes(p.contextLimit) &&
      [0.02, 0.05, 0.1].includes(p.unsupportedMargin) &&
      p.minLength === 0,
    "INVALID_CONFIG",
  );
  requireValue(stable(p) === stable(DEFAULT_DETECTION_PARAMETERS), "PARAMETER_MISMATCH");
  verifiedFile(project, config.calibrationReport, config.calibrationReportSha256);
  return objectHash(config);
}

export function evaluationOutcome(sample: LoadedSample, result: LanguageDetectionResult): Outcome {
  return result.state === "reliable"
    ? sample.truth.expectedLanguageIds.includes(result.languageId)
      ? "correct"
      : "incorrect"
    : result.state;
}

export interface EvaluationRecord {
  sampleId: string;
  result: LanguageDetectionResult;
  outcome: Outcome;
  elapsedMs: number;
  providerCalls: number;
}

export function summarizeCorpus(corpus: LoadedCorpus, records: readonly EvaluationRecord[]) {
  const byId = unique(records, (record) => record.sampleId, "DUPLICATE_RESULT");
  requireValue(
    records.length === corpus.samples.length && corpus.samples.every((s) => byId.has(s.sampleId)),
    "INCOMPLETE_RESULTS",
  );
  const strata = new Map<string, LoadedSample[]>();
  for (const sample of corpus.samples.filter((s) => s.primary)) {
    const keys = [
      "overall",
      `length:${lengthGroup(sample.originalCueCount)}`,
      ...Object.keys(sample.truth.languageLetters).map((id) => `language:${baseLanguage(id)}`),
      ...sample.tags.map((tag) => `content:${tag}`),
      ...(sample.truth.positive
        ? ["positive", `positive:${lengthGroup(sample.originalCueCount)}`]
        : []),
    ];
    for (const key of new Set(keys)) strata.set(key, [...(strata.get(key) ?? []), sample]);
  }
  return [...strata].map(([stratum, samples]) => {
    const counts: Record<Outcome, number> = {
      correct: 0,
      incorrect: 0,
      unknown: 0,
      unsupported: 0,
    };
    for (const sample of samples) counts[byId.get(sample.sampleId)!.outcome] += 1;
    return {
      stratum,
      denominator: samples.length,
      counts,
      rates: Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [key, count / samples.length]),
      ),
    };
  });
}
