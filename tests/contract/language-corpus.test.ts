import { describe, expect, it } from "vitest";
import {
  corpusManifestHash,
  loadCorpusVersionIndex,
  loadLanguageCorpus,
  loadLocalLanguageRegressions,
  loadMixedLanguageCases,
  loadSameLanguageCases,
  loadVersionedLanguageCorpus,
  resolveCorpusFile,
  validateCorpusBoundary,
  validateCorpusPurpose,
  validateParsedLanguageSample,
  validateVersionedCorpusBoundary,
} from "../helpers/language-corpus.js";

describe("frozen language corpus", () => {
  it("loads independently licensed natural tracks through production SRT and ASS parsers", () => {
    const calibration = loadLanguageCorpus("calibration");
    const acceptance = loadLanguageCorpus("acceptance");
    expect(calibration.tracks.length).toBe(65);
    expect(acceptance.tracks.length).toBe(415);
    expect(
      acceptance.tracks.filter((sample) => sample.record.languageTruth.kind === "positive").length,
    ).toBe(402);
    expect(acceptance.tracks.filter((sample) => sample.record.format === "ass").length).toBe(1);
    expect(calibration.manifest.manifestHash === corpusManifestHash(calibration.manifest)).toBe(
      true,
    );
    expect(acceptance.manifest.manifestHash === corpusManifestHash(acceptance.manifest)).toBe(true);
  });

  it("rejects source-group leakage even when bodies and metadata labels differ", () => {
    const calibration = structuredClone(loadLanguageCorpus("calibration").manifest);
    const acceptance = loadLanguageCorpus("acceptance").manifest;
    calibration.samples[0]!.sourceGroupId = acceptance.samples[0]!.sourceGroupId;
    expect(() => validateCorpusBoundary(calibration, acceptance)).toThrow("source-group-leak");
  });

  it("rejects duplicated bodies instead of counting different files as independent tracks", () => {
    const calibration = loadLanguageCorpus("calibration").manifest;
    const acceptance = structuredClone(loadLanguageCorpus("acceptance").manifest);
    acceptance.samples[1]!.bodyHash = acceptance.samples[0]!.bodyHash;
    expect(() => validateCorpusBoundary(calibration, acceptance)).toThrow("duplicate-body");
  });

  it("rejects overlapping excerpts, including canonical mappings across media editions", () => {
    const calibration = loadLanguageCorpus("calibration").manifest;
    const acceptance = structuredClone(loadLanguageCorpus("acceptance").manifest);
    const original = acceptance.samples.find(
      (sample) => sample.regressionId === "regression-short-5",
    )!;
    const other = acceptance.samples.find(
      (sample) => sample.canonicalTrackId === original.canonicalTrackId,
    )!;
    other.canonicalCueRange = [...original.canonicalCueRange];
    expect(() => validateCorpusBoundary(calibration, acceptance)).toThrow(
      "overlapping-source-cues",
    );
  });

  it("rejects a missing natural positive instead of compensating with authored negative boundaries", () => {
    const calibration = loadLanguageCorpus("calibration").manifest;
    const acceptance = structuredClone(loadLanguageCorpus("acceptance").manifest);
    const index = acceptance.samples.findIndex(
      (sample) => sample.languageTruth.languageId === "sv",
    );
    acceptance.samples.splice(index, 1);
    expect(() => validateCorpusBoundary(calibration, acceptance)).toThrow(
      "independent-positive-count",
    );
  });

  it("verifies actual parsed counts and bodies without exposing subtitle text in failures", () => {
    const loaded = loadLanguageCorpus("acceptance").tracks[0]!;
    const badCount = { ...loaded.record, cueCount: loaded.record.cueCount + 1 };
    expect(() => validateParsedLanguageSample(badCount, loaded.source, loaded.cues)).toThrow(
      "cue-count",
    );
    const badLetters = { ...loaded.record, letterCount: loaded.record.letterCount + 1 };
    expect(() => validateParsedLanguageSample(badLetters, loaded.source, loaded.cues)).toThrow(
      "letter-count",
    );
    const badBody = { ...loaded.record, bodyHash: "0".repeat(64) };
    expect(() => validateParsedLanguageSample(badBody, loaded.source, loaded.cues)).toThrow(
      "body-hash",
    );
    const badRange = structuredClone(loaded.record);
    badRange.sourceCueIndices[0] = 0;
    badRange.cueRange[0] = 0;
    badRange.canonicalCueRange[0] = 0;
    expect(() => validateParsedLanguageSample(badRange, loaded.source, loaded.cues)).toThrow(
      "source-cue-bounds",
    );
  });

  it.each([
    "../../docs/local/private.srt",
    "/private/subtitle.srt",
    "tracks/../private.srt",
    "tracks/private.srt?token=secret",
  ])("rejects paths outside the frozen fixture layout (%#)", (file) => {
    expect(() => resolveCorpusFile(file)).toThrow("file-scope");
  });

  it("keeps seven exact FFmpeg regressions as metadata without putting bodies in the frozen set", () => {
    const local = loadLocalLanguageRegressions();
    const acceptance = loadLanguageCorpus("acceptance");
    const bodies = new Set(acceptance.tracks.map((sample) => sample.record.sha256));
    expect(local.length).toBe(7);
    expect(local.every((sample) => !bodies.has(sample.extractedSha256))).toBe(true);
    expect(local.filter((sample) => sample.expected.state === "unknown").length).toBe(1);
  });

  it("prelabels exact request strings and explicit target variants before provider acceptance", () => {
    const frozen = loadSameLanguageCases();
    expect(frozen.cases.length).toBe(11);
    expect(frozen.cases.reduce((count, testCase) => count + testCase.items.length, 0)).toBe(17);
    expect(
      frozen.cases.some((testCase) => testCase.items.some((item) => item.text.includes("\n\n"))),
    ).toBe(true);
    expect(
      frozen.cases.some((testCase) =>
        testCase.items.some((item) => item.text.startsWith("  ") && item.text.endsWith("  ")),
      ),
    ).toBe(true);
    expect(
      frozen.cases.some((testCase) =>
        testCase.items.some((item) => item.expectation === "translate"),
      ),
    ).toBe(true);
  });
});

describe("versioned language corpus purposes", () => {
  it("keeps evaluated works reproducible and separates at least 400 fresh natural positives from semantic cases", () => {
    const index = loadCorpusVersionIndex();
    const known = index.versions.find((entry) => entry.purpose === "known-regression")!;
    expect(validateCorpusPurpose(index, "known-regression", known.version)).toBe(known);
    const calibration = loadVersionedLanguageCorpus("calibration");
    const holdout = loadVersionedLanguageCorpus("holdout");
    expect(calibration.tracks.length).toBe(749);
    expect(holdout.tracks.length).toBe(407);
    expect(holdout.manifest.languages).toHaveLength(20);
    expect(
      holdout.tracks.filter(({ record }) => record.languageTruth.kind === "positive"),
    ).toHaveLength(400);
    expect(holdout.tracks.filter(({ record }) => record.format === "ass")).toHaveLength(1);
    expect(
      calibration.tracks.some(
        ({ record, cues }) =>
          record.languageTruth.kind === "positive" &&
          cues.map((cue) => cue.normalizedText).join("\n").length > 4096,
      ),
    ).toBe(true);
    expect(
      calibration.tracks.some(({ record }) => record.sourceGroupId === "elephants-dream"),
    ).toBe(false);
    for (const language of ["id", "ru", "bg", "es", "gl", "sv", "no"])
      expect(
        calibration.tracks.some(({ record }) => record.languageTruth.languageId === language),
      ).toBe(true);
  });

  it("rejects evaluated or wrong-purpose material as a fresh holdout", () => {
    const index = structuredClone(loadCorpusVersionIndex());
    const holdout = index.versions.find(
      (entry) => entry.version === index.activeVersion && entry.purpose === "holdout",
    )!;
    holdout.evaluation.state = "evaluated";
    expect(() => validateCorpusPurpose(index, "holdout")).toThrow("evaluated-holdout");
    expect(() => validateCorpusPurpose(index, "holdout", index.versions[0]!.version)).toThrow(
      "version-purpose",
    );
  });

  it("rejects whole-work leakage and missing natural positives in a new version", () => {
    const calibration = loadVersionedLanguageCorpus("calibration").manifest;
    const holdout = structuredClone(loadVersionedLanguageCorpus("holdout").manifest);
    expect(() =>
      validateVersionedCorpusBoundary(
        calibration,
        holdout,
        new Set([holdout.samples[0]!.sourceGroupId]),
      ),
    ).toThrow("source-group-leak");
    holdout.samples.shift();
    expect(() => validateVersionedCorpusBoundary(calibration, holdout, new Set())).toThrow(
      "independent-positive-count",
    );
    const badCalibration = structuredClone(calibration);
    badCalibration.samples[0]!.sourceGroupId = "elephants-dream";
    expect(() => validateVersionedCorpusBoundary(badCalibration, holdout, new Set())).toThrow(
      "designated-work-calibration",
    );
  });

  it("prelabels mixed text intervals and exact 55:45 / 40:35:25 weights before detection", () => {
    const { cases } = loadMixedLanguageCases();
    expect(cases).toHaveLength(14);
    expect(
      cases
        .find(({ record }) => record.caseId === "mixed-v2-55-45")!
        .record.annotations.map((part) => part.letterCount),
    ).toEqual([110, 90]);
    expect(
      cases
        .find(({ record }) => record.caseId === "mixed-v2-40-35-25")!
        .record.annotations.map((part) => part.letterCount),
    ).toEqual([160, 140, 100]);
    expect(
      cases.some(({ record }) => record.annotations.some((part) => part.languageId === null)),
    ).toBe(true);
    expect(
      cases
        .find(({ record }) => record.caseId === "mixed-v2-tie")!
        .record.annotations.map((part) => part.letterCount),
    ).toEqual([110, 110]);
  });
});
