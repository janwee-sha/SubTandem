import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isTargetLanguageId } from "../../src/domain/target-languages.js";
import { parseAss } from "../../src/subtitles/ass.js";
import { parseSrt } from "../../src/subtitles/srt.js";
import type { EmbeddedSubtitleCodec, SubtitleCue } from "../../src/subtitles/types.js";

export type CorpusSplit = "calibration" | "acceptance";

export interface CorpusSource {
  sourceWorkId: string;
  sourceGroupId: string;
  canonicalTrackId: string;
  canonicalCueRange?: [number, number];
  sourceUrl: string;
  sourceTrack: string;
  rawSha256: string;
  originalCueCount: number;
  maxCueIndex: number;
  license: string;
  attribution: string[];
  licenseEvidence: string;
  licenseEvidenceSha256: string;
  origin: "natural-subtitle" | "authored-boundary";
}

export interface LanguageSample {
  sampleId: string;
  sourceTrack: string;
  sourceWorkId: string;
  sourceGroupId: string;
  file: string;
  format: "srt" | "ass";
  sha256: string;
  bodyHash: string;
  cueRange: [number, number];
  sourceCueIndices: number[];
  canonicalTrackId: string;
  canonicalCueRange: [number, number];
  cueCount: number;
  letterCount: number;
  languageTruth: { kind: "positive"; languageId: string } | { kind: "negative"; languageId: null };
  reviewBasis: string;
  phenomena: string[];
  split: CorpusSplit;
  regressionId?: string;
}

export interface LanguageManifest {
  schemaVersion: number;
  frozenRevision: string;
  sourceCatalogHash: string;
  status: string;
  reviewer: string;
  split: CorpusSplit;
  samples: LanguageSample[];
  manifestHash: string;
}

export interface LoadedLanguageSample {
  record: LanguageSample;
  source: CorpusSource;
  cues: SubtitleCue[];
}

export interface LocalLanguageRegression {
  regressionId: string;
  sourceUrl: string;
  mediaSha256: string;
  inputEnvironment: string;
  ffIndex: number;
  codec: EmbeddedSubtitleCodec;
  cueRange: [number, number];
  cueCount: number;
  letterCount: number;
  extractedSha256: string;
  expected: { state: "reliable"; languageId: string } | { state: "unknown" };
}

export interface SameLanguageItem {
  id: string;
  sampleId: string;
  cueIndices: number[];
  transform: "identity" | "blank-line" | "pad" | "upper";
  text: string;
  expectation: "verbatim" | "translate";
}

export interface SameLanguageCase {
  caseId: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  phenomena: string[];
  items: SameLanguageItem[];
  reviewBasis: string;
}

interface SourceCatalog {
  schemaVersion: number;
  frozenRevision: string;
  sources: Record<string, CorpusSource>;
  manifestHash: string;
}

interface SameLanguageManifest {
  schemaVersion: number;
  frozenRevision: string;
  acceptanceManifestHash: string;
  sourceCatalogHash: string;
  cases: SameLanguageCase[];
  manifestHash: string;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const corpusRoot = fileURLToPath(new URL("../fixtures/languages/", import.meta.url));
const digestPattern = /^[a-f0-9]{64}$/;
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;
export const REQUIRED_CORPUS_LANGUAGES =
  "en de hu it ru sv he fi es fr pt nl da cs pl el id ja zh fa".split(" ");

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`language-corpus:${code}`);
}

export function corpusSha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function corpusManifestHash(input: object): string {
  const content = { ...input } as Record<string, unknown>;
  delete content.manifestHash;
  return corpusSha256(JSON.stringify(content));
}

export function resolveCorpusFile(file: string): string {
  check(
    /^(?:tracks\/[A-Za-z0-9-]+\.(?:srt|ass)|licenses\/[a-z-]+\.md|[a-z-]+\.json)$/.test(file),
    "file-scope",
  );
  try {
    const root = realpathSync(corpusRoot);
    const path = realpathSync(resolve(root, file));
    check(path.startsWith(root + sep), "file-scope");
    return path;
  } catch {
    throw new Error("language-corpus:file-unavailable");
  }
}

function trackedFiles(): Set<string> {
  try {
    return new Set(
      execFileSync("git", ["ls-files", "-z", "--", "tests/fixtures/languages"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\0")
        .filter(Boolean),
    );
  } catch {
    throw new Error("language-corpus:version-control-unavailable");
  }
}

function reader() {
  const tracked = trackedFiles();
  return (file: string): Buffer => {
    const path = resolveCorpusFile(file);
    check(tracked.has(relative(repositoryRoot, path)), "untracked-file");
    try {
      return readFileSync(path);
    } catch {
      throw new Error("language-corpus:file-unavailable");
    }
  };
}

function readJson<T>(read: (file: string) => Buffer, file: string): T {
  try {
    return JSON.parse(read(file).toString("utf8")) as T;
  } catch {
    throw new Error("language-corpus:manifest-unavailable");
  }
}

function checkSeal(value: { manifestHash: string }): void {
  check(digestPattern.test(value.manifestHash), "manifest-hash-format");
  check(corpusManifestHash(value) === value.manifestHash, "manifest-hash");
}

export function validateCorpusBoundary(
  calibration: LanguageManifest,
  acceptance: LanguageManifest,
): void {
  const identities = new Set<string>();
  const bodies = new Set<string>();
  const groups = new Map<string, CorpusSplit>();
  const intervals = new Map<string, Array<[number, number]>>();
  for (const manifest of [calibration, acceptance]) {
    check(manifest.schemaVersion === 2 && manifest.status === "frozen", "manifest-state");
    check(manifest.reviewer.length > 0 && manifest.samples.length > 0, "review-missing");
    for (const sample of manifest.samples) {
      check(identityPattern.test(sample.sampleId), "sample-id");
      check(!identities.has(sample.sampleId), "duplicate-id");
      check(!bodies.has(sample.bodyHash), "duplicate-body");
      check(sample.split === manifest.split, "sample-split");
      check(sample.reviewBasis.length > 0, "truth-review-missing");
      const groupSplit = groups.get(sample.sourceGroupId);
      check(groupSplit === undefined || groupSplit === sample.split, "source-group-leak");
      groups.set(sample.sourceGroupId, sample.split);
      identities.add(sample.sampleId);
      bodies.add(sample.bodyHash);
      const key = `${sample.sourceGroupId}/${sample.canonicalTrackId}`;
      const ranges = intervals.get(key) ?? [];
      ranges.push(sample.canonicalCueRange);
      intervals.set(key, ranges);
    }
  }
  for (const ranges of intervals.values()) {
    ranges.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < ranges.length; index += 1)
      check(ranges[index - 1]![1] < ranges[index]![0], "overlapping-source-cues");
  }
  const counts = new Map<string, number>();
  for (const sample of acceptance.samples) {
    if (sample.languageTruth.kind !== "positive") continue;
    check(!sample.phenomena.includes("authored-boundary"), "non-natural-positive");
    counts.set(
      sample.languageTruth.languageId,
      (counts.get(sample.languageTruth.languageId) ?? 0) + 1,
    );
  }
  check(counts.size >= 20, "language-count");
  for (const language of REQUIRED_CORPUS_LANGUAGES)
    check((counts.get(language) ?? 0) >= 20, "independent-positive-count");
  const phenomena = new Set(acceptance.samples.flatMap((sample) => sample.phenomena));
  for (const required of [
    "short",
    "medium",
    "long",
    "shared-script",
    "romanized-japanese",
    "lyrics",
    "mixed",
    "ass-styling",
  ])
    check(phenomena.has(required), "missing-phenomenon");
  for (const [id, count, language] of [
    ["regression-short-5", 5, "en"],
    ["regression-short-6", 6, "de"],
  ] as const) {
    const sample = acceptance.samples.find((sample) => sample.regressionId === id);
    check(sample?.sampleId === id && sample.cueCount === count, "designated-short-input");
    check(
      sample.languageTruth.kind === "positive" && sample.languageTruth.languageId === language,
      "designated-short-truth",
    );
  }
  check(
    acceptance.samples.some((sample) => sample.languageTruth.kind === "negative"),
    "negative-count",
  );
}

export function validateParsedLanguageSample(
  record: LanguageSample,
  source: CorpusSource,
  cues: SubtitleCue[],
): void {
  check(
    record.sourceWorkId === source.sourceWorkId && record.sourceGroupId === source.sourceGroupId,
    "source-identity",
  );
  check(record.canonicalTrackId === source.canonicalTrackId, "canonical-track");
  check(
    JSON.stringify(record.canonicalCueRange) ===
      JSON.stringify(source.canonicalCueRange ?? record.cueRange),
    "canonical-range",
  );
  check(cues.length === record.cueCount && cues.length > 0, "cue-count");
  check(record.sourceCueIndices.length === cues.length, "source-cue-count");
  check(
    record.sourceCueIndices[0] === record.cueRange[0] &&
      record.sourceCueIndices.at(-1) === record.cueRange[1],
    "source-range",
  );
  check(
    record.sourceCueIndices.every(
      (value, index, values) =>
        Number.isInteger(value) &&
        value >= 1 &&
        value <= source.maxCueIndex &&
        (index === 0 || value > values[index - 1]!),
    ),
    "source-cue-bounds",
  );
  const body = cues.map((cue) => cue.normalizedText);
  check(corpusSha256(JSON.stringify(body)) === record.bodyHash, "body-hash");
  check((body.join("\n").match(/\p{L}/gu)?.length ?? 0) === record.letterCount, "letter-count");
  const length = cues.length < 12 ? "short" : cues.length <= 30 ? "medium" : "long";
  check(record.phenomena.includes(length), "length-stratum");
  if (record.languageTruth.kind === "positive")
    check(
      source.origin === "natural-subtitle" &&
        REQUIRED_CORPUS_LANGUAGES.includes(record.languageTruth.languageId),
      "positive-truth",
    );
  else
    check(
      record.languageTruth.kind === "negative" && record.languageTruth.languageId === null,
      "negative-truth",
    );
}

export function loadLanguageCorpus(split: CorpusSplit): {
  manifest: LanguageManifest;
  tracks: LoadedLanguageSample[];
} {
  const read = reader();
  const catalog = readJson<SourceCatalog>(read, "sources.json");
  const calibration = readJson<LanguageManifest>(read, "calibration.json");
  const acceptance = readJson<LanguageManifest>(read, "acceptance.json");
  for (const manifest of [catalog, calibration, acceptance]) checkSeal(manifest);
  check(
    catalog.schemaVersion === 1 &&
      calibration.split === "calibration" &&
      acceptance.split === "acceptance",
    "schema",
  );
  for (const manifest of [calibration, acceptance])
    check(
      manifest.sourceCatalogHash === catalog.manifestHash &&
        manifest.frozenRevision === catalog.frozenRevision,
      "source-catalog-version",
    );
  validateCorpusBoundary(calibration, acceptance);
  const manifest = split === "calibration" ? calibration : acceptance;
  const licenses = new Map<string, string>();
  const tracks = manifest.samples.map((record): LoadedLanguageSample => {
    const source = catalog.sources[record.sourceTrack];
    check(source, "missing-source");
    check(URL.canParse(source.sourceUrl), "source-url");
    const url = new URL(source.sourceUrl);
    check(url.protocol === "https:" && !url.username && !url.password, "source-url");
    check(digestPattern.test(source.rawSha256), "source-hash-format");
    check(
      ["CC-BY-2.5", "CC-BY-3.0", "CC-BY-SA-4.0", "GPL-3.0-only"].includes(source.license),
      "license",
    );
    check(
      source.attribution.length > 0 && source.attribution.every((value) => value.trim().length > 0),
      "attribution",
    );
    if (!licenses.has(source.licenseEvidence))
      licenses.set(source.licenseEvidence, corpusSha256(read(source.licenseEvidence)));
    check(
      licenses.get(source.licenseEvidence) === source.licenseEvidenceSha256,
      "license-evidence-hash",
    );
    const bytes = read(record.file);
    check(corpusSha256(bytes) === record.sha256, "file-hash");
    check(record.format === "srt" || record.format === "ass", "subtitle-format");
    const parsed = (record.format === "srt" ? parseSrt : parseAss)(bytes.toString("utf8"));
    check(parsed.warnings.length === 0, "parse-warning");
    validateParsedLanguageSample(record, source, parsed.cues);
    return { record, source, cues: parsed.cues };
  });
  return { manifest, tracks };
}

export function loadLocalLanguageRegressions(): LocalLanguageRegression[] {
  const value = readJson<{
    schemaVersion: number;
    scope: string;
    regressions: LocalLanguageRegression[];
  }>(reader(), "local-regressions.json");
  check(Object.keys(value).sort().join(",") === "regressions,schemaVersion,scope", "local-fields");
  check(value.schemaVersion === 1 && value.scope === "local-acceptance-only", "local-scope");
  const expectedIds = [
    "regression-en-38",
    "regression-de-11",
    "regression-hu-19",
    "regression-it-19",
    "regression-ru-19",
    "regression-sv-19",
    "regression-romaji-29",
  ];
  const sourceUrls = [
    "https://samples.ffmpeg.org/Matroska/subtitles/honey.mkv",
    "https://samples.ffmpeg.org/MPEG-4/embedded_subs/1Video_2Audio_2SUBs_timed_text_streams_.mp4",
    "https://samples.ffmpeg.org/Matroska/subtitles/SSA_15subtitles.mkv",
  ];
  check(
    value.regressions.length === 7 &&
      new Set(value.regressions.map((row) => row.regressionId)).size === 7,
    "local-count",
  );
  for (const row of value.regressions) {
    check(
      Object.keys(row).sort().join(",") ===
        "codec,cueCount,cueRange,expected,extractedSha256,ffIndex,inputEnvironment,letterCount,mediaSha256,regressionId,sourceUrl",
      "local-fields",
    );
    check(expectedIds.includes(row.regressionId), "local-id");
    check(/^SUBTANDEM_LANGUAGE_MEDIA_[ABC]$/.test(row.inputEnvironment), "local-input-environment");
    check(
      digestPattern.test(row.mediaSha256) && digestPattern.test(row.extractedSha256),
      "local-hash",
    );
    check(sourceUrls.includes(row.sourceUrl), "local-source");
    check(
      Number.isInteger(row.ffIndex) &&
        row.ffIndex >= 0 &&
        ["ass", "ssa", "mov_text"].includes(row.codec),
      "local-stream",
    );
    check(
      row.cueRange[0] === 1 &&
        row.cueRange[1] === row.cueCount &&
        row.cueCount === Number(row.regressionId.split("-").at(-1)) &&
        Number.isInteger(row.letterCount) &&
        row.letterCount > 0,
      "local-counts",
    );
    const unknown = row.regressionId === "regression-romaji-29";
    check(
      unknown
        ? Object.keys(row.expected).join(",") === "state" && row.expected.state === "unknown"
        : Object.keys(row.expected).sort().join(",") === "languageId,state" &&
            row.expected.state === "reliable" &&
            row.expected.languageId === row.regressionId.split("-")[1],
      "local-truth",
    );
  }
  return value.regressions;
}

export function loadSameLanguageCases(): SameLanguageManifest {
  const value = readJson<SameLanguageManifest>(reader(), "same-language.json");
  checkSeal(value);
  const acceptance = loadLanguageCorpus("acceptance");
  check(
    value.schemaVersion === 1 &&
      value.frozenRevision === acceptance.manifest.frozenRevision &&
      value.acceptanceManifestHash === acceptance.manifest.manifestHash &&
      value.sourceCatalogHash === acceptance.manifest.sourceCatalogHash,
    "same-language-version",
  );
  const caseIds = new Set<string>();
  for (const testCase of value.cases) {
    check(
      identityPattern.test(testCase.caseId) && !caseIds.has(testCase.caseId),
      "same-language-case-id",
    );
    caseIds.add(testCase.caseId);
    check(isTargetLanguageId(testCase.targetLanguage), "same-language-target");
    check(
      testCase.sourceLanguage === null ||
        REQUIRED_CORPUS_LANGUAGES.includes(testCase.sourceLanguage),
      "same-language-source",
    );
    check(testCase.items.length > 0 && testCase.reviewBasis.length > 0, "same-language-review");
    const ids = new Set<string>();
    for (const item of testCase.items) {
      check(identityPattern.test(item.id) && !ids.has(item.id), "same-language-item-id");
      ids.add(item.id);
      check(
        item.expectation === "verbatim" || item.expectation === "translate",
        "same-language-expectation",
      );
      check(
        ["identity", "blank-line", "pad", "upper"].includes(item.transform),
        "same-language-transform",
      );
      const sample = acceptance.tracks.find((sample) => sample.record.sampleId === item.sampleId);
      check(sample && item.cueIndices.length > 0, "same-language-sample");
      const parts = item.cueIndices.map((index) => {
        check(
          Number.isInteger(index) && index >= 1 && index <= sample.cues.length,
          "same-language-cue",
        );
        return sample.cues[index - 1]!.sourceText;
      });
      let text = parts.join(item.transform === "blank-line" ? "\n\n" : "\n");
      if (item.transform === "pad") text = `  ${text}  `;
      if (item.transform === "upper") text = text.toUpperCase();
      check(text === item.text && text.trim().length > 0, "same-language-text");
    }
  }
  const phenomena = new Set(value.cases.flatMap((testCase) => testCase.phenomena));
  for (const required of [
    "known-same-language",
    "unknown-source",
    "mixed-items",
    "punctuation",
    "case",
    "spaces",
    "multiline",
    "internal-blank-line",
    "repeated",
    "target-variant",
  ])
    check(phenomena.has(required), "same-language-coverage");
  for (const target of ["zh-Hans", "zh-Hant", "pt-PT"])
    check(
      value.cases.some((testCase) => testCase.targetLanguage === target),
      "same-language-variant",
    );
  return value;
}
