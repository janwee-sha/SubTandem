import { readFileSync } from "node:fs";

import { freezeTranslationTargets } from "../../src/app/request-builder.js";
import type { FrozenTranslationTarget } from "../../src/providers/types.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

export interface ProviderLanguageDetectionCase {
  id: string;
  targetLanguage: string;
  trackLanguage: string | null;
  cues: string[];
}

interface ProviderLanguageDetectionFixture {
  version: number;
  cases: ProviderLanguageDetectionCase[];
}

export interface OllamaQualityAcceptanceCase {
  id: string;
  targetLanguage: string;
  inputText: string;
  contextPrevious: string;
  contextNext: string;
  replayOutput: string;
  expectedReplayValid: boolean;
  exact?: boolean;
  requiredScript?: "han";
  requiredAny?: string[][];
  forbiddenFragments?: string[];
}

interface OllamaQualityAcceptanceFixture {
  version: number;
  cases: OllamaQualityAcceptanceCase[];
}

export function loadProviderLanguageDetectionFixture(): ProviderLanguageDetectionFixture {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/providers/provider-language-detection.json", import.meta.url),
      "utf8",
    ),
  ) as ProviderLanguageDetectionFixture;
  if (fixture.version !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("Invalid provider language detection fixture");
  }
  return fixture;
}

export function loadOllamaQualityAcceptanceFixture(): OllamaQualityAcceptanceFixture {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/providers/ollama-quality-acceptance.json", import.meta.url),
      "utf8",
    ),
  ) as OllamaQualityAcceptanceFixture;
  if (fixture.version !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("Invalid Ollama quality acceptance fixture");
  }
  return fixture;
}

export function buildFixtureCues(testCase: ProviderLanguageDetectionCase): SubtitleCue[] {
  return testCase.cues.map((sourceText, index) => ({
    id: `${testCase.id}-${index + 1}`,
    index: index + 1,
    startMs: index * 2_000,
    endMs: index * 2_000 + 1_800,
    sourceText,
    normalizedText: sourceText,
    contextText: sourceText,
  }));
}

export function freezeFixtureTargets(
  testCase: ProviderLanguageDetectionCase,
  targetIndexes?: readonly number[],
): FrozenTranslationTarget[] {
  const windowCues = buildFixtureCues(testCase);
  const requestedIndexes = targetIndexes ?? windowCues.map((_, index) => index);
  const targetCues = requestedIndexes.map((index) => {
    const cue = windowCues[index];
    if (!cue) throw new Error(`Unknown fixture cue index: ${index}`);
    return cue;
  });
  return freezeTranslationTargets({ windowCues, targetCues });
}

export function freezeOllamaQualityTarget(
  testCase: OllamaQualityAcceptanceCase,
): FrozenTranslationTarget[] {
  return [
    {
      id: testCase.id,
      text: testCase.inputText,
      contextPrevious: testCase.contextPrevious,
      contextNext: testCase.contextNext,
    },
  ];
}

export function ollamaQualityIssues(
  testCase: OllamaQualityAcceptanceCase,
  output: string | undefined,
): string[] {
  if (output === undefined) return ["missing-output"];
  if (!output.trim()) return ["blank-output"];
  const issues: string[] = [];
  if (testCase.exact) {
    if (output !== testCase.inputText) issues.push("not-character-exact");
  } else if (output === testCase.inputText) {
    issues.push("unchanged-non-target");
  }
  if (testCase.requiredScript === "han" && !/\p{Script=Han}/u.test(output)) {
    issues.push("missing-han-script");
  }
  for (const requiredGroup of testCase.requiredAny ?? []) {
    if (!requiredGroup.some((fragment) => output.includes(fragment))) {
      issues.push("missing-required-fragment");
    }
  }
  for (const fragment of testCase.forbiddenFragments ?? []) {
    if (output.toLocaleLowerCase().includes(fragment.toLocaleLowerCase())) {
      issues.push("forbidden-fragment");
    }
  }
  return [...new Set(issues)];
}

export function expectExactText(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `Expected exact text ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
