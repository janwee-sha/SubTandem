import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { freezeTranslationTargets } from "../../src/app/request-builder.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { ProviderTransport, ProviderTransportRequest } from "../../src/providers/transport.js";
import type {
  ProviderAttemptError,
  TranslationBatchRequest,
  TranslationBatchResult,
} from "../../src/providers/types.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import {
  freezeFixtureTargets,
  freezeOllamaQualityTarget,
  loadProviderLanguageDetectionFixture,
  loadOllamaQualityAcceptanceFixture,
  ollamaQualityIssues,
} from "../helpers/provider-language-detection.js";

class FetchTransport implements ProviderTransport {
  async request(request: ProviderTransportRequest) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      return { statusCode: response.status, headers, bodyText: await response.text() };
    } catch (error) {
      const timeout =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw {
        category: timeout ? "timeout" : "network",
        retryable: true,
        providerCode: timeout ? "LIVE_TRANSPORT_TIMEOUT" : "LIVE_TRANSPORT_NETWORK",
        userAction: "CHECK_NETWORK",
      } satisfies ProviderAttemptError;
    }
  }
}

const live = process.env.SUBTANDEM_LIVE_PROVIDER_TEST === "1";
const liveDeepSeek = process.env.SUBTANDEM_LIVE_DEEPSEEK_TEST === "1";
const liveClaude = process.env.SUBTANDEM_LIVE_CLAUDE_TEST === "1";
const languageFixture = loadProviderLanguageDetectionFixture();
const ollamaQualityFixture = loadOllamaQualityAcceptanceFixture();
const languageMatrix = [
  { caseId: "same-language-preservation", exactIndexes: [0, 1, 2, 3, 4, 5] },
  { caseId: "mixed-language-batch", exactIndexes: [2, 5] },
  { caseId: "traditional-chinese-target", exactIndexes: [] },
] as const;

interface LiveEvidenceIdentity {
  provider: "openai" | "ollama" | "deepseek" | "claude";
  model: string;
  caseId: string;
}

interface LiveTranslationCounts {
  adjacentContext: number;
  sourceEcho: number;
  romanization: number;
  fieldName: number;
  languageLabel: number;
  explanation: number;
  thinking: number;
  unknownId: number;
}

function makeLiveAcceptanceRequest(count = 50): TranslationBatchRequest {
  const sourcePool = ["short-five-cues", "short-eleven-cues-missing-label", "medium-natural-dialogue"]
    .flatMap((caseId) => languageFixture.cases.find((entry) => entry.id === caseId)?.cues ?? []);
  const cues = Array.from({ length: count }, (_, index) => {
    const sourceText = sourcePool[index % sourcePool.length]!;
    return {
      id: `live-safe-${index + 1}`,
      index: index + 1,
      startMs: index * 2_000,
      endMs: index * 2_000 + 1_800,
      sourceText,
      normalizedText: sourceText,
      contextText: sourceText,
    };
  });
  return {
    ...makeProviderRequest(),
    items: freezeTranslationTargets({ windowCues: cues, targetCues: cues }),
  };
}

function expectCleanLiveTranslations(
  request: TranslationBatchRequest,
  result: TranslationBatchResult,
  identity: LiveEvidenceIdentity,
  allowedExactIds: ReadonlySet<string> = new Set(),
): void {
  const byId = new Map(request.items.map((target) => [target.id, target]));
  const counts: LiveTranslationCounts = {
    adjacentContext: 0,
    sourceEcho: 0,
    romanization: 0,
    fieldName: 0,
    languageLabel: 0,
    explanation: 0,
    thinking: 0,
    unknownId: 0,
  };
  for (const translation of result.translations) {
    const target = byId.get(translation.id);
    if (!target) {
      counts.unknownId += 1;
      continue;
    }
    if (
      [target.contextPrevious, target.contextNext].some(
        (context) => context && translation.text.includes(context),
      )
    )
      counts.adjacentContext += 1;
    if (
      translation.text.includes(target.text) &&
      (!allowedExactIds.has(target.id) || translation.text !== target.text)
    )
      counts.sourceEcho += 1;
    if (/\b(?:pinyin|romanization|romaji)\b/i.test(translation.text)) counts.romanization += 1;
    if (/\b(?:targets?|context_previous|context_next|text|id)\b/i.test(translation.text))
      counts.fieldName += 1;
    if (/\b(?:source language|target language|English|Chinese)\b/i.test(translation.text))
      counts.languageLabel += 1;
    if (/(?:^|\n)\s*(?:translation|note|explanation)\s*[:：]/i.test(translation.text))
      counts.explanation += 1;
    if (/<\/?think(?:ing)?\b/i.test(translation.text)) counts.thinking += 1;
  }
  const evidence = {
    ...identity,
    complete: result.translations.length === request.items.length,
    ordered: result.translations.every((item, index) => item.id === request.items[index]?.id),
    counts,
  };
  console.info(JSON.stringify({ liveProviderEvidence: evidence }));
  expect.soft(evidence, `${identity.provider}:${identity.model}:${identity.caseId}`).toEqual({
    ...identity,
    complete: true,
    ordered: true,
    counts: {
      adjacentContext: 0,
      sourceEcho: 0,
      romanization: 0,
      fieldName: 0,
      languageLabel: 0,
      explanation: 0,
      thinking: 0,
      unknownId: 0,
    },
  });
}

async function runLanguageMatrix(
  provider: {
    attempt(request: TranslationBatchRequest): Promise<TranslationBatchResult>;
  },
  identity: Omit<LiveEvidenceIdentity, "caseId">,
): Promise<void> {
  for (const matrixCase of languageMatrix) {
    const testCase = languageFixture.cases.find((entry) => entry.id === matrixCase.caseId)!;
    const request = {
      ...makeProviderRequest(),
      targetLanguage: testCase.targetLanguage,
      items: freezeFixtureTargets(testCase),
    };
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    const resultsById = new Map(result.translations.map((item) => [item.id, item.text]));
    const exactByIndex = matrixCase.exactIndexes.map((index) => {
      const item = request.items[index];
      return item !== undefined && resultsById.get(item.id) === item.text;
    });
    const exactMatches = exactByIndex.filter(Boolean).length;
    const mismatches = matrixCase.exactIndexes.flatMap((index) => {
      const item = request.items[index];
      const output = item ? resultsById.get(item.id) : undefined;
      if (!item || output === undefined || output === item.text) return [];
      return [
        {
          index,
          inputCodePoints: [...item.text].length,
          outputCodePoints: [...output].length,
          inputNewlines: item.text.match(/\n/g)?.length ?? 0,
          outputNewlines: output.match(/\n/g)?.length ?? 0,
          equalWithoutWhitespace: item.text.replace(/\s/g, "") === output.replace(/\s/g, ""),
        },
      ];
    });
    const evidence = {
      ...identity,
      caseId: matrixCase.caseId,
      complete: result.translations.length === request.items.length,
      exact: exactMatches === matrixCase.exactIndexes.length,
      exactByIndex,
      exactMatches,
      exactExpected: matrixCase.exactIndexes.length,
      mismatches,
      nonblank: result.translations.every((item) => item.text.trim().length > 0),
    };
    console.info(JSON.stringify({ liveProviderEvidence: evidence }));
    expect.soft(evidence, matrixCase.caseId).toEqual({
      ...identity,
      caseId: matrixCase.caseId,
      complete: true,
      exact: true,
      exactByIndex: matrixCase.exactIndexes.map(() => true),
      exactMatches: matrixCase.exactIndexes.length,
      exactExpected: matrixCase.exactIndexes.length,
      mismatches: [],
      nonblank: true,
    });
  }
}

async function runOllamaQualityMatrix(
  provider: OllamaProvider,
  identity: Omit<LiveEvidenceIdentity, "caseId">,
): Promise<void> {
  for (const testCase of ollamaQualityFixture.cases) {
    const request = {
      ...makeProviderRequest(),
      targetLanguage: testCase.targetLanguage,
      items: freezeOllamaQualityTarget(testCase),
    };
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    const output = result.translations.find((item) => item.id === testCase.id)?.text;
    const issueCount = ollamaQualityIssues(testCase, output).length;
    const evidence = {
      ...identity,
      caseId: testCase.id,
      complete: result.translations.length === 1 && output !== undefined,
      ordered: result.translations[0]?.id === testCase.id,
      valid: issueCount === 0,
      issueCount,
    };
    console.info(JSON.stringify({ liveProviderEvidence: evidence }));
    expect.soft(evidence, testCase.id).toEqual({
      ...identity,
      caseId: testCase.id,
      complete: true,
      ordered: true,
      valid: true,
      issueCount: 0,
    });
  }
}

async function withSafeProviderDiagnostics<T>(
  operation: Promise<T>,
  safeCounts: () => Record<string, number> = () => ({}),
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const value =
      error && typeof error === "object" && !Array.isArray(error)
        ? (error as Record<string, unknown>)
        : {};
    throw new Error(
      JSON.stringify({
        category: value.category ?? "unknown",
        retryable: value.retryable === true,
        ...(typeof value.statusCode === "number" ? { statusCode: value.statusCode } : {}),
        ...(typeof value.providerCode === "string" ? { providerCode: value.providerCode } : {}),
        ...(typeof value.userAction === "string" ? { userAction: value.userAction } : {}),
        ...safeCounts(),
      }),
    );
  }
}

describe.skipIf(!live)("authorized live provider smoke tests", () => {
  it("probes and translates with the configured OpenAI-compatible service", async () => {
    const endpoint = process.env.SUBTANDEM_OPENAI_ENDPOINT;
    const model = process.env.SUBTANDEM_OPENAI_MODEL;
    const apiKey = process.env.SUBTANDEM_OPENAI_KEY;
    expect(endpoint).toBeTruthy();
    expect(model).toBeTruthy();
    const provider = new OpenAICompatibleProvider(
      {
        endpoint: endpoint!,
        model: model!,
        ...(apiKey ? { apiKey } : {}),
        sessionId: randomUUID(),
      },
      new FetchTransport(),
    );

    await expect(withSafeProviderDiagnostics(provider.probe())).resolves.toMatch(
      /^(strict-json-schema|json-object|prompt-json)$/,
    );
    const request = makeLiveAcceptanceRequest();
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    expectCleanLiveTranslations(request, result, {
      provider: "openai",
      model: model!,
      caseId: "fifty-cue",
    });
    await runLanguageMatrix(provider, { provider: "openai", model: model! });
  }, 300_000);

  it("probes and translates with the configured Ollama service", async () => {
    const endpoint = process.env.SUBTANDEM_OLLAMA_ENDPOINT;
    const model = process.env.SUBTANDEM_OLLAMA_MODEL;
    const apiKey = process.env.SUBTANDEM_OLLAMA_KEY;
    expect(endpoint).toBeTruthy();
    expect(model).toBeTruthy();
    const provider = new OllamaProvider(
      { endpoint: endpoint!, model: model!, ...(apiKey ? { apiKey } : {}) },
      new FetchTransport(),
    );

    await expect(withSafeProviderDiagnostics(provider.probe())).resolves.toMatchObject({ model });
    const request = makeLiveAcceptanceRequest();
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    expectCleanLiveTranslations(request, result, {
      provider: "ollama",
      model: model!,
      caseId: "fifty-cue",
    });
    await runLanguageMatrix(provider, { provider: "ollama", model: model! });
    await runOllamaQualityMatrix(provider, { provider: "ollama", model: model! });
  }, 600_000);
});

describe.skipIf(!liveDeepSeek)("authorized DeepSeek live acceptance", () => {
  it("runs a fresh Test and at least twenty two-item wires", async () => {
    const model = process.env.SUBTANDEM_DEEPSEEK_MODEL;
    const apiKey = process.env.SUBTANDEM_DEEPSEEK_KEY;
    expect(model).toBeTruthy();
    expect(apiKey).toBeTruthy();
    const provider = new DeepSeekProvider(
      {
        endpoint: "https://api.deepseek.com",
        model: model!,
        apiKey: apiKey!,
      },
      new FetchTransport(),
    );

    const tested = await withSafeProviderDiagnostics(provider.testConnection("deepseek-live-test"));
    expect(tested.model === model).toBe(true);
    const request = makeLiveAcceptanceRequest(40);
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    expect(request.items).toHaveLength(40);
    expectCleanLiveTranslations(request, result, {
      provider: "deepseek",
      model: model!,
      caseId: "forty-cue",
    });
    await runLanguageMatrix(provider, { provider: "deepseek", model: model! });
  }, 600_000);
});

describe.skipIf(!liveClaude)("authorized Claude-compatible live acceptance", () => {
  it("runs a fresh Messages Test and at least twenty two-item wires", async () => {
    const endpoint = process.env.SUBTANDEM_CLAUDE_ENDPOINT;
    const model = process.env.SUBTANDEM_CLAUDE_MODEL;
    const apiKey = process.env.SUBTANDEM_CLAUDE_KEY;
    expect(endpoint).toBeTruthy();
    expect(model).toBeTruthy();
    expect(apiKey).toBeTruthy();
    const provider = new ClaudeProvider(
      { endpoint: endpoint!, model: model!, apiKey: apiKey! },
      new FetchTransport(),
    );

    const tested = await withSafeProviderDiagnostics(provider.testConnection("claude-live-test"));
    expect(tested).toEqual({ model });
    const request = makeLiveAcceptanceRequest(40);
    let completedTargets = 0;
    const result = await withSafeProviderDiagnostics(
      provider.attempt(request, (progress) => {
        completedTargets += progress.translations.length;
      }),
      () => ({ completedTargets }),
    );
    expect(request.items).toHaveLength(40);
    expectCleanLiveTranslations(request, result, {
      provider: "claude",
      model: model!,
      caseId: "forty-cue",
    });
    await runLanguageMatrix(provider, { provider: "claude", model: model! });
  }, 600_000);
});
