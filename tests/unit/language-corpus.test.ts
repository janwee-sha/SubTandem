import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditCorpusDrafts,
  corpusHash,
  coverageIssues,
  evaluationOutcome,
  loadCorpus,
  loadFrozenCorpora,
  normalizedCorpusText,
  summarizeCorpus,
  verifyCorpusIsolation,
  verifyDetectorConfiguration,
  detectorConfigurationFiles,
  type CorpusManifest,
} from "../helpers/language-corpus.js";
import { loadSubtitleSource } from "../../src/subtitles/source.js";
import { DEFAULT_DETECTION_PARAMETERS } from "../../src/subtitles/language-detection.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function structuralFixture() {
  const root = mkdtempSync(join(tmpdir(), "subtandem-corpus-admission-"));
  roots.push(root);
  const body =
    "1\n00:00:00,000 --> 00:00:01,000\nCafe\u0301 <i>now</i> https://example.com\n\n2\n00:00:01,000 --> 00:00:02,000\nThe door is open.\n";
  const bytes = Buffer.from(body);
  const parsed = loadSubtitleSource({ id: 1, isExternal: true, title: "structural.srt" }, bytes);
  if (!parsed.ok) throw new Error("STRUCTURAL_FIXTURE_PARSE_FAILED");
  const normalized = normalizedCorpusText(parsed.source.cues);
  const count = normalized.match(/\p{L}/gu)!.length;
  writeFileSync(join(root, "source.srt"), body);
  writeFileSync(join(root, "sample.srt"), body);
  writeFileSync(
    join(root, "LICENSE.txt"),
    "Test-only structural fixture; never an accuracy corpus.",
  );
  const manifest: CorpusManifest = {
    schemaVersion: 1,
    version: "structural-test",
    split: "calibration",
    sources: [
      {
        sourceId: "source",
        workId: "test-work",
        lineageIds: ["test-translation"],
        url: "https://example.com/structural-test",
        revision: "test-only",
        authors: ["test-author"],
        translators: ["not-applicable"],
        file: "source.srt",
        sha256: corpusHash(bytes),
        license: "test-only",
        licenseUrl: "https://example.com/test-license",
        licenseFile: "LICENSE.txt",
        licenseSha256: corpusHash("Test-only structural fixture; never an accuracy corpus."),
        attribution: "Synthetic input for admission boundary tests only",
        acquiredAt: "2026-09-09",
        redistributionVerifiedBy: "test-only",
      },
    ],
    groups: [
      {
        groupId: "group",
        sourceIds: ["source"],
        lineageIds: ["test-work", "test-translation"],
        split: "calibration",
      },
    ],
    samples: [
      {
        sampleId: "sample",
        groupId: "group",
        file: "sample.srt",
        sha256: corpusHash(bytes),
        normalizedSha256: corpusHash(normalized),
        originalRanges: [{ sourceId: "source", startCue: 0, endCue: 2 }],
        originalCueCount: 2,
        effectiveLetterCount: count,
        format: "srt",
        tags: ["structural-test-only"],
        statisticalUnitId: "unit",
        kind: "natural",
        derivedFrom: [],
        truth: {
          spans: [{ startLetter: 0, endLetter: count, languageId: "en" }],
          languageLetters: { en: count },
          chineseForm: null,
          expectedLanguageIds: ["en"],
          sufficient: false,
          positive: false,
          behavior: "candidate",
          reviewedBy: "test-only",
          reviewedAt: "2026-09-09",
          evidence: ["Synthetic data exercising the validator, not a language truth claim."],
          naturalnessEvidence: "Test-only marker to exercise schema acceptance; never frozen.",
        },
      },
    ],
    units: [{ statisticalUnitId: "unit", primarySampleId: "sample", sampleIds: ["sample"] }],
  };
  const save = () => writeFileSync(join(root, "calibration.json"), JSON.stringify(manifest));
  save();
  return { root, manifest, save };
}

describe("language corpus admission boundaries", () => {
  it("rejects changes to the frozen implementation, installed models, parameters and calibration evidence", () => {
    const { root } = structuralFixture();
    const config = {
      schemaVersion: 1,
      status: "frozen",
      ...detectorConfigurationFiles(),
      parameters: { ...DEFAULT_DETECTION_PARAMETERS },
      calibrationReport: "package.json",
      calibrationReportSha256: corpusHash(
        readFileSync(new URL("../../package.json", import.meta.url)),
      ),
    };
    const save = (value: typeof config) =>
      writeFileSync(join(root, "detector-config.json"), JSON.stringify(value));
    save(config);
    expect(verifyDetectorConfiguration(root)).toMatch(/^[a-f0-9]{64}$/);
    for (const mutate of [
      (value: typeof config) => {
        value.files["src/subtitles/language-detection.ts"] = "0".repeat(64);
      },
      (value: typeof config) => {
        value.models["franc-all/data.js"] = "0".repeat(64);
      },
      (value: typeof config) => {
        value.parameters.totalLetterBudget =
          value.parameters.totalLetterBudget === 4096 ? 8192 : 4096;
      },
      (value: typeof config) => {
        value.calibrationReportSha256 = "0".repeat(64);
      },
    ]) {
      const changed = structuredClone(config);
      mutate(changed);
      save(changed);
      expect(() => verifyDetectorConfiguration(root)).toThrow(/LANGUAGE_CORPUS_/);
    }
  });
  it("blocks evaluation when detector configuration is not frozen", () => {
    const { root } = structuralFixture();
    expect(() => verifyDetectorConfiguration(root)).toThrow("LANGUAGE_CORPUS_CONFIG_NOT_FROZEN");
  });
  it("audits draft files and coverage without admitting unreviewed truth", () => {
    const { root, manifest, save } = structuralFixture();
    manifest.samples[0]!.truth.reviewedBy = "";
    manifest.samples[0]!.truth.reviewedAt = "";
    save();
    const ids = new Set(["source", "test-work", "test-translation", "group", "sample", "unit"]);
    const acceptance = JSON.parse(JSON.stringify(manifest), (_key, value: unknown) => {
      if (typeof value !== "string") return value;
      if (ids.has(value)) return `${value}-acceptance`;
      if (value === "source.srt" || value === "sample.srt") return `acceptance-${value}`;
      return value;
    }) as CorpusManifest;
    acceptance.split = "acceptance";
    acceptance.groups[0]!.split = "acceptance";
    const body = "1\n00:00:00,000 --> 00:00:02,000\nPlease keep this window closed.\n";
    writeFileSync(join(root, "acceptance-source.srt"), body);
    writeFileSync(join(root, "acceptance-sample.srt"), body);
    acceptance.sources[0]!.sha256 = corpusHash(body);
    const sample = acceptance.samples[0]!;
    sample.sha256 = corpusHash(body);
    sample.normalizedSha256 = corpusHash("Please keep this window closed.");
    sample.originalCueCount = 1;
    sample.originalRanges[0]!.endCue = 1;
    sample.effectiveLetterCount = 26;
    sample.truth.spans = [{ startLetter: 0, endLetter: 26, languageId: "en" }];
    sample.truth.languageLetters = { en: 26 };
    writeFileSync(join(root, "acceptance.json"), JSON.stringify(acceptance));
    const reports = auditCorpusDrafts(root);
    expect(reports.map((report) => report.pendingReview)).toEqual([
      ["sample"],
      ["sample-acceptance"],
    ]);
    expect(reports[0]!.proposedCoverageIssues).toContain("languages:0/20");
    expect(() => loadCorpus("calibration", root)).toThrow("TRUTH_NOT_REVIEWED");
    expect(() => loadFrozenCorpora(root)).toThrow("TRUTH_NOT_REVIEWED");
    writeFileSync(join(root, "acceptance-sample.srt"), "tampered");
    expect(() => auditCorpusDrafts(root)).toThrow("FILE_HASH_MISMATCH");
  });

  it("does not treat distinct nonlinguistic boundaries as shared language evidence", () => {
    const { root } = structuralFixture();
    const left = loadCorpus("calibration", root);
    const right = structuredClone(left);
    for (const [index, corpus] of [left, right].entries()) {
      corpus.manifest.sources = [];
      corpus.manifest.groups = [];
      corpus.manifest.units = [];
      const sample = corpus.samples[0]!;
      sample.sampleId = `no-letters-${index}`;
      const text = index === 0 ? "123 ?!" : "456 …";
      sample.sha256 = corpusHash(`file-${text}`);
      sample.normalizedSha256 = corpusHash(text);
      sample.cues = [{ ...sample.cues[0]!, sourceText: text, normalizedText: text }];
    }
    expect(() => verifyCorpusIsolation(left, right)).not.toThrow();
    right.samples[0]!.normalizedSha256 = left.samples[0]!.normalizedSha256;
    expect(() => verifyCorpusIsolation(left, right)).toThrow("CROSS_SPLIT_LEAKAGE");
  });

  it("uses production parsing and excludes URLs, markup and combining marks from letter weights", () => {
    const { root } = structuralFixture();
    const corpus = loadCorpus("calibration", root);
    expect(corpus.samples[0]!.effectiveLetterCount).toBe(20);
    expect(corpus.samples[0]!.cues).toHaveLength(2);
    expect(coverageIssues(corpus)).toContain("length:short:0/20");
    expect(coverageIssues(corpus)).toContain("content:natural-hausa");
  });

  it("rejects looping templates regardless of declared language count or license", () => {
    const { root } = structuralFixture();
    writeFileSync(
      join(root, "calibration.json"),
      JSON.stringify({
        source: "synthetic",
        license: "CC0",
        cycles: 100,
        languages: Array.from({ length: 20 }, () => ({ templates: ["one", "two"] })),
      }),
    );
    expect(() => loadCorpus("calibration", root)).toThrow("NATURAL_MANIFEST_REQUIRED");
  });

  it("rejects modified bytes, missing permission evidence and unreviewed truth without echoing content", () => {
    const { root, manifest, save } = structuralFixture();
    writeFileSync(join(root, "sample.srt"), "PRIVATE-SENTINEL");
    expect(() => loadCorpus("calibration", root)).toThrow(/^LANGUAGE_CORPUS_FILE_HASH_MISMATCH$/);
    manifest.sources[0]!.redistributionVerifiedBy = "";
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("SOURCE_NOT_ADMITTED");
    manifest.sources[0]!.redistributionVerifiedBy = "test-only";
    manifest.samples[0]!.truth.reviewedBy = "";
    writeFileSync(join(root, "sample.srt"), readFileSync(join(root, "source.srt")));
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("TRUTH_NOT_REVIEWED");
  });

  it("rejects gaps in language spans and a false supported winner", () => {
    const { root, manifest, save } = structuralFixture();
    manifest.samples[0]!.truth.spans[0]!.startLetter = 1;
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("INVALID_SPANS");
    manifest.samples[0]!.truth.spans[0]!.startLetter = 0;
    manifest.samples[0]!.truth.expectedLanguageIds = ["de"];
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("EXPECTED_LANGUAGE_MISMATCH");
  });

  it("rejects duplicated natural cues disguised as a second independent sample", () => {
    const { root, manifest, save } = structuralFixture();
    manifest.samples.push({
      ...structuredClone(manifest.samples[0]!),
      sampleId: "copy",
      statisticalUnitId: "unit-copy",
    });
    manifest.units.push({
      statisticalUnitId: "unit-copy",
      primarySampleId: "copy",
      sampleIds: ["copy"],
    });
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("REUSED_NATURAL_CUE");
  });

  it("rejects shared works even when their file and sample identities differ", () => {
    const { root } = structuralFixture();
    const left = loadCorpus("calibration", root);
    const right = structuredClone(left);
    right.manifest.split = "acceptance";
    right.manifest.sources[0]!.sourceId = "other-source";
    right.manifest.sources[0]!.sha256 = "0".repeat(64);
    right.manifest.sources[0]!.lineageIds = [];
    right.manifest.groups = [];
    right.manifest.units = [];
    right.samples = [];
    expect(() => verifyCorpusIsolation(left, right)).toThrow("CROSS_SPLIT_LEAKAGE");
  });

  it("does not count parallel translations as independent natural excerpts", () => {
    const { root, manifest, save } = structuralFixture();
    manifest.sources.push({ ...manifest.sources[0]!, sourceId: "translation" });
    manifest.groups[0]!.sourceIds.push("translation");
    manifest.samples.push({
      ...structuredClone(manifest.samples[0]!),
      sampleId: "translated-sample",
      statisticalUnitId: "translated-unit",
      originalRanges: [{ sourceId: "translation", startCue: 0, endCue: 2 }],
    });
    manifest.units.push({
      statisticalUnitId: "translated-unit",
      primarySampleId: "translated-sample",
      sampleIds: ["translated-sample"],
    });
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("PARALLEL_TRANSLATION_UNIT_MISMATCH");
  });

  it("keeps unsupported letters in the denominator while deriving the supported winner", () => {
    const { root, manifest, save } = structuralFixture();
    const truth = manifest.samples[0]!.truth;
    truth.spans = [
      { startLetter: 0, endLetter: 12, languageId: "fi" },
      { startLetter: 12, endLetter: 17, languageId: "en" },
      { startLetter: 17, endLetter: 20, languageId: "de" },
    ];
    truth.languageLetters = { fi: 12, en: 5, de: 3 };
    save();
    const sample = loadCorpus("calibration", root).samples[0]!;
    expect(sample.truth.expectedLanguageIds).toEqual(["en"]);
    expect(Object.values(sample.truth.languageLetters).reduce((a, b) => a + b, 0)).toBe(20);
    truth.expectedLanguageIds = ["fi"];
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("EXPECTED_LANGUAGE_MISMATCH");
  });

  it("rejects cyclic derivations and variants promoted to statistical primaries", () => {
    const { root, manifest, save } = structuralFixture();
    manifest.samples.push({
      ...structuredClone(manifest.samples[0]!),
      sampleId: "variant",
      kind: "variant",
      derivedFrom: ["sample"],
    });
    manifest.units[0]!.sampleIds.push("variant");
    manifest.samples[0]!.derivedFrom = ["variant"];
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("NATURAL_PRIMARY_REQUIRED");
    manifest.samples[0]!.derivedFrom = [];
    manifest.samples[1]!.derivedFrom = ["loop"];
    manifest.samples.push({
      ...structuredClone(manifest.samples[1]!),
      sampleId: "loop",
      derivedFrom: ["variant"],
    });
    manifest.units[0]!.sampleIds.push("loop");
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("CYCLIC_DERIVATION");
    manifest.units[0]!.primarySampleId = "variant";
    save();
    expect(() => loadCorpus("calibration", root)).toThrow("NATURAL_PRIMARY_REQUIRED");
  });

  it("keeps variants out of accuracy denominators and refusals out of correct recognition", () => {
    const { root } = structuralFixture();
    const corpus = loadCorpus("calibration", root);
    const sample = corpus.samples[0]!;
    corpus.samples.push({
      ...sample,
      sampleId: "variant",
      primary: false,
      kind: "variant",
      derivedFrom: [sample.sampleId],
    });
    const records = corpus.samples.map((s) => ({
      sampleId: s.sampleId,
      result: { state: "unknown" as const },
      outcome: evaluationOutcome(s, { state: "unknown" }),
      elapsedMs: 0,
      providerCalls: 0,
    }));
    const summary = summarizeCorpus(corpus, records);
    expect(summary.find((entry) => entry.stratum === "overall")).toMatchObject({
      denominator: 1,
      counts: { correct: 0, incorrect: 0, unknown: 1, unsupported: 0 },
    });
    expect(() => summarizeCorpus(corpus, records.slice(0, 1))).toThrow("INCOMPLETE_RESULTS");
    expect(evaluationOutcome(sample, { state: "reliable", languageId: "ha" })).toBe("incorrect");
    expect(evaluationOutcome(sample, { state: "unsupported" })).toBe("unsupported");
  });

  it("never silently switches to calibration when the acceptance corpus is missing", () => {
    const { root } = structuralFixture();
    expect(() => loadFrozenCorpora(root)).toThrow("MANIFEST_UNAVAILABLE");
  });
});
