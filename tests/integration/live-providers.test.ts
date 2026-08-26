import { describe, expect, it } from "vitest";

import { freezeTranslationTargets } from "../../src/app/request-builder.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import type { ProviderTransport, ProviderTransportRequest } from "../../src/providers/transport.js";
import type { TranslationBatchRequest, TranslationBatchResult } from "../../src/providers/types.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import { createTranslationAlignmentFixture } from "../helpers/translation-alignment.js";

class FetchTransport implements ProviderTransport {
  async request(request: ProviderTransportRequest) {
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
  }
}

const live = process.env.SUBTANDEM_LIVE_PROVIDER_TEST === "1";

function makeLiveAcceptanceRequest(): TranslationBatchRequest {
  const { continuousCues } = createTranslationAlignmentFixture();
  const cues = continuousCues.slice(0, 50);
  return {
    ...makeProviderRequest(),
    items: freezeTranslationTargets({ windowCues: cues, targetCues: cues }),
  };
}

function expectCleanLiveTranslations(
  request: TranslationBatchRequest,
  result: TranslationBatchResult,
): void {
  const byId = new Map(request.items.map((target) => [target.id, target]));
  const counts = {
    adjacentContext: 0,
    sourceEcho: 0,
    romanization: 0,
    fieldName: 0,
    languageLabel: 0,
    explanation: 0,
  };
  for (const translation of result.translations) {
    const target = byId.get(translation.id)!;
    if (
      [target.contextPrevious, target.contextNext].some(
        (context) => context && translation.text.includes(context),
      )
    )
      counts.adjacentContext += 1;
    if (translation.text.includes(target.text)) counts.sourceEcho += 1;
    if (/\b(?:pinyin|romanization|romaji)\b/i.test(translation.text)) counts.romanization += 1;
    if (/\b(?:targets?|context_previous|context_next|text|id)\b/i.test(translation.text))
      counts.fieldName += 1;
    if (/\b(?:source language|target language|English|Chinese)\b/i.test(translation.text))
      counts.languageLabel += 1;
    if (/(?:^|\n)\s*(?:translation|note|explanation)\s*[:：]/i.test(translation.text))
      counts.explanation += 1;
  }
  expect(result.translations.map((item) => item.id)).toEqual(request.items.map((item) => item.id));
  expect(counts).toEqual({
    adjacentContext: 0,
    sourceEcho: 0,
    romanization: 0,
    fieldName: 0,
    languageLabel: 0,
    explanation: 0,
  });
}

async function withSafeProviderDiagnostics<T>(operation: Promise<T>): Promise<T> {
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
        sessionId: "live-provider-test",
      },
      new FetchTransport(),
    );

    await expect(withSafeProviderDiagnostics(provider.probe())).resolves.toMatch(
      /^(strict-json-schema|json-object|prompt-json)$/,
    );
    const request = makeLiveAcceptanceRequest();
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    expectCleanLiveTranslations(request, result);
  }, 300_000);

  it("probes and translates with the configured Ollama service", async () => {
    const endpoint = process.env.SUBTANDEM_OLLAMA_ENDPOINT;
    const model = process.env.SUBTANDEM_OLLAMA_MODEL;
    expect(endpoint).toBeTruthy();
    expect(model).toBeTruthy();
    const provider = new OllamaProvider(
      { endpoint: endpoint!, model: model! },
      new FetchTransport(),
    );

    await expect(withSafeProviderDiagnostics(provider.probe())).resolves.toMatchObject({ model });
    const request = makeLiveAcceptanceRequest();
    const result = await withSafeProviderDiagnostics(provider.attempt(request));
    expectCleanLiveTranslations(request, result);
  }, 600_000);
});
