import { describe, expect, it } from "vitest";
import {
  corpusManifestHash,
  loadLanguageCorpus,
  loadLocalLanguageRegressions,
  loadSameLanguageCases,
  resolveCorpusFile,
  validateCorpusBoundary,
  validateParsedLanguageSample,
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
