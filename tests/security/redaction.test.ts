import { describe, expect, it } from "vitest";
import { diagnostic, safeRequestId } from "../../src/domain/logging.js";
import { SubtitleExtractorError } from "../../src/adapters/iina/subtitle-extractor.js";
import { PlaybackController, type TranslationOverlaySink } from "../../src/app/controller.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import { parseTargetLanguageSave } from "../../src/domain/messages.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";

describe("allowlist-only diagnostics", () => {
  it("does not add style values or helper internals to diagnostic allowlists", () => {
    const output = diagnostic({
      code: "PICKER_UNAVAILABLE",
      token: "PRIVATE_PICKER_TOKEN",
      color: { r: 1, g: 2, b: 3, a: 4 },
      fontFamily: "PRIVATE_FONT_FAMILY",
      subtitle: "PRIVATE_SUBTITLE",
      mediaPath: "/private/media.mkv",
    });
    expect(output).toEqual({ code: "PICKER_UNAVAILABLE" });
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE|media\.mkv|fontFamily|color|token/);
  });
  it("drops Claude error, refusal, raw response, headers and subtitle bodies", async () => {
    const sensitive = "PRIVATE_CLAUDE_UPSTREAM_SUBTITLE";
    const provider = new ClaudeProvider(
      {
        endpoint: "https://api.anthropic.com",
        model: "exact-model",
        apiKey: "private-key",
      },
      {
        request: async () => ({
          statusCode: 529,
          headers: {
            "request-id": "bad\nAuthorization: private-key",
            "x-private": sensitive,
          },
          bodyText: JSON.stringify({
            type: "error",
            error: { type: "UNKNOWN_PRIVATE_CODE", message: sensitive },
            refusal: sensitive,
          }),
        }),
      },
    );
    const request = makeProviderRequest();
    request.items[0]!.text = sensitive;

    const failure = await provider.attempt(request).catch((error) => error);

    expect(failure).toMatchObject({
      category: "http",
      retryable: true,
      statusCode: 529,
      providerCode: "CLAUDE_MESSAGES_HTTP_529",
    });
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE|authorization|x-private|unknown/i);
  });

  it("never writes Claude subtitle context or translations to the translation log", async () => {
    const messages: string[] = [];
    const controller = new PlaybackController({
      playerId: "claude-log",
      providerKind: "claude",
      provider: {
        attempt: async (request) => ({
          translations: request.items.map((item) => ({
            id: item.id,
            text: "PRIVATE_CLAUDE_TRANSLATION",
          })),
        }),
      },
      overlay: { show: () => undefined, clear: () => undefined },
      targetLanguage: "zh-Hans",
      translationLog: (message) => messages.push(message),
    });
    controller.setSource({
      cues: [
        {
          id: "private-cue",
          index: 0,
          startMs: 0,
          endMs: 1_000,
          sourceText: "PRIVATE_CLAUDE_SOURCE",
          normalizedText: "PRIVATE_CLAUDE_SOURCE",
        },
      ],
      contentHash: "private-content",
      language: "en",
      format: "srt",
    });

    controller.tick(0);
    await controller.whenIdle();

    expect(messages).toEqual([]);
  });

  it.each([
    [401, "authentication", false, "CHECK_CREDENTIALS"],
    [403, "authentication", false, "CHECK_CREDENTIALS"],
    [402, "quota", false, "CHECK_QUOTA"],
    [429, "http", true, "CHECK_NETWORK"],
    [400, "configuration", false, "CHECK_ENDPOINT"],
    [422, "configuration", false, "CHECK_ENDPOINT"],
    [500, "http", true, "CHECK_NETWORK"],
    [503, "http", true, "CHECK_NETWORK"],
  ] as const)(
    "classifies DeepSeek HTTP %s without exposing upstream content",
    async (statusCode, category, retryable, userAction) => {
      const provider = new DeepSeekProvider(
        { endpoint: "https://api.deepseek.com", model: "exact-model" },
        {
          request: async () => ({
            statusCode,
            headers: {
              "x-request-id": "bad\nAuthorization: Bearer upstream-secret",
              "x-private": "private-header",
            },
            bodyText: JSON.stringify({
              error: {
                code: "PRIVATE_UPSTREAM_CODE",
                message: "PRIVATE_UPSTREAM_BODY",
              },
            }),
          }),
        },
      );

      const failure = await provider.attempt(makeProviderRequest()).catch((error) => error);
      expect(failure).toMatchObject({ category, retryable, statusCode, userAction });
      expect(JSON.stringify(failure)).not.toMatch(
        /PRIVATE|upstream-secret|authorization|x-request-id|x-private/i,
      );
    },
  );

  it("copies safe metadata and drops bodies, headers, credentials and subtitle text", () => {
    const output = diagnostic({
      code: "PROVIDER_HTTP",
      category: "http",
      statusCode: 503,
      requestId: "req-123",
      authorization: "Bearer secret",
      body: "private subtitle",
      credential: "key-value",
    });
    expect(output).toEqual({
      code: "PROVIDER_HTTP",
      category: "http",
      statusCode: 503,
      requestId: "req-123",
    });
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(JSON.stringify(output)).not.toContain("subtitle");
  });

  it("sanitizes provider request IDs", () => {
    expect(safeRequestId("safe_Request-42.abc")).toBe("safe_Request-42.abc");
    expect(safeRequestId("bad\nAuthorization: secret")).toBeUndefined();
  });

  it("exposes only fixed extractor error codes", () => {
    const error = new SubtitleExtractorError("TRACK_IDENTITY_MISMATCH");
    expect(JSON.stringify({ name: error.name, code: error.code, message: error.message })).toBe(
      '{"name":"SubtitleExtractorError","code":"TRACK_IDENTITY_MISMATCH","message":"TRACK_IDENTITY_MISMATCH"}',
    );
  });

  it("does not expose overlay failures or translated bodies through controller state", async () => {
    const sensitive = "PRIVATE_TRANSLATION_ASS_DATA /private/media/title.mkv";
    const overlay: TranslationOverlaySink = {
      show: () => {
        throw new Error(sensitive);
      },
      clear: () => undefined,
    };
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: request.items.map((item) => ({ id: item.id, text: sensitive })),
      }),
    };
    const controller = new PlaybackController({
      playerId: "player-A",
      provider,
      overlay,
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: [
        {
          id: "cue-1",
          index: 0,
          startMs: 0,
          endMs: 1_000,
          sourceText: "PRIVATE_SOURCE_SUBTITLE",
          normalizedText: "PRIVATE_SOURCE_SUBTITLE",
        },
      ],
      contentHash: "hash",
      language: "en",
      format: "srt",
    });
    controller.tick(0);
    await controller.whenIdle();

    const state = JSON.stringify({
      status: controller.status,
      providerError: controller.providerError,
    });
    expect(state).not.toContain("PRIVATE_TRANSLATION_ASS_DATA");
    expect(state).not.toContain("PRIVATE_SOURCE_SUBTITLE");
    expect(state).not.toContain("/private/media/title.mkv");
  });

  it("drops provider request, response, endpoint and subtitle details from failed controller state", async () => {
    const sensitive = [
      "PRIVATE_SOURCE_BODY",
      "PRIVATE_TRANSLATION_BODY",
      "http://private.example:8080/v1",
      "Bearer private",
      "provider raw response",
    ];
    const controller = new PlaybackController({
      playerId: "redaction",
      provider: {
        attempt: async () => {
          throw {
            category: "authentication",
            retryable: false,
            statusCode: 401,
            endpoint: sensitive[2],
            authorization: sensitive[3],
            requestBody: sensitive[0],
            responseBody: sensitive[4],
            translation: sensitive[1],
          };
        },
      },
      overlay: { show: () => undefined, clear: () => undefined },
      targetLanguage: "zh-Hans",
    });
    controller.setSource({
      cues: [
        {
          id: "private-cue",
          index: 0,
          startMs: 0,
          endMs: 1_000,
          sourceText: sensitive[0]!,
          normalizedText: sensitive[0]!,
        },
      ],
      contentHash: "private-content",
      language: "en",
      format: "srt",
    });

    controller.tick(0);
    await controller.whenIdle();

    const state = JSON.stringify({ status: controller.status, error: controller.providerError });
    expect(controller.providerError).toMatchObject({
      category: "authentication",
      retryable: false,
      userAction: "CHECK_CREDENTIALS",
    });
    for (const value of sensitive) expect(state).not.toContain(value);
  });

  it("rejects legacy source preferences before they can cross the language RPC", () => {
    expect(() =>
      parseTargetLanguageSave({
        requestId: "save",
        revision: 1,
        payload: {
          targetLanguage: "en",
          sourceLanguage: "PRIVATE_OLD_SOURCE_LANGUAGE",
          sourceLanguageMode: "manual",
        },
      }),
    ).toThrow(/INVALID_TARGET_LANGUAGE/);
  });
});
