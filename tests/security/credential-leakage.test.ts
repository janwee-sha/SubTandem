import { describe, expect, it } from "vitest";
import { diagnostic } from "../../src/domain/logging.js";
import { parseProviderModelsResult, sanitizedProfileView } from "../../src/domain/messages.js";
import { readFileSync } from "node:fs";
import { SubtitlePreparationCoordinator } from "../../src/app/subtitle-preparation.js";
import { SubtitleExtractorError } from "../../src/adapters/iina/subtitle-extractor.js";
import { detectSubtitleLanguage } from "../../src/subtitles/language-detection.js";
import { buildTranslationTask } from "../../src/providers/translation-task.js";
import type { SubtitleCue } from "../../src/subtitles/types.js";

describe("credential and content leakage boundaries", () => {
  it("rejects secret and raw response fields in model refresh results", () => {
    for (const field of ["apiKey", "authorization", "endpoint", "responseBody"]) {
      expect(() =>
        parseProviderModelsResult({
          requestId: "models-safe",
          ok: false,
          contextKey: "opaque",
          category: "authentication",
          retryable: false,
          userAction: "CHECK_CREDENTIALS",
          [field]: "remote-secret",
        }),
      ).toThrow("INVALID_MESSAGE");
    }
  });

  it("keeps draft credentials out of reusable model contexts and result messages", () => {
    const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
    const catalogSource = readFileSync(
      new URL("../../src/adapters/iina/model-catalog-sync.ts", import.meta.url),
      "utf8",
    );
    const previewTokenStart = catalogSource.indexOf("modelCatalogPreviewContextToken");
    const previewTokenEnd = catalogSource.indexOf(
      "export class ModelCatalogSync",
      previewTokenStart,
    );
    const previewTokenSource = catalogSource.slice(previewTokenStart, previewTokenEnd);
    const mainStart = mainSource.indexOf('onMessage("provider:models-preview"');
    const mainEnd = mainSource.indexOf('onMessage("profile:delete-request"', mainStart);
    const mainHandler = mainSource.slice(mainStart, mainEnd);

    expect(previewTokenStart).toBeGreaterThan(-1);
    expect(previewTokenSource).toContain("draftCredentialEpoch");
    expect(previewTokenSource).not.toContain("apiKey");
    expect(mainHandler).toContain("parseProviderModelsPreviewRequest");
    expect(mainHandler).toContain("cacheResult: false");
    expect(mainHandler).not.toContain("raw,");
  });

  it("keeps credentials, local paths, loopback tokens, auth headers and bodies out of views/diagnostics", () => {
    const sensitive = [
      "provider-secret",
      "/private/plugin-data/credentials.json",
      "loopback-token",
      "Bearer private",
      "private subtitle",
      "private translation",
    ];
    const profileView = sanitizedProfileView({
      profileId: "p",
      revision: 1,
      displayName: "p",
      kind: "openai",
      endpoint: "http://provider.example.test:8080/v1",
      endpointFingerprint: "f",
      credential: { apiKey: sensitive[0]! },
    });
    const output = JSON.stringify({
      preferences: { targetLanguage: "zh-Hans" },
      profileView,
      diagnostic: diagnostic({
        code: "FAIL",
        authorization: sensitive[3],
        body: sensitive[4],
        translation: sensitive[5],
        token: sensitive[2],
        key: sensitive[1],
      }),
    });
    for (const value of sensitive) expect(output).not.toContain(value);
  });

  it("keeps media paths, subtitle text, job IDs and native details out of preparation views", async () => {
    const sensitive = [
      "/private/media/private-title.mkv",
      "private subtitle body",
      "7a90a4e6-cc4f-4f59-99b7-8ff522f887ae",
      "libavformat private failure",
    ];
    const coordinator = new SubtitlePreparationCoordinator({
      playerId: "player-A",
      extractor: {
        prepare: async () => {
          throw new SubtitleExtractorError("EXTRACTION_FAILED");
        },
        cancel: async () => "unknown",
        release: async () => undefined,
        shutdown: async () => undefined,
      },
      readResult: () => new TextEncoder().encode(sensitive[1]),
      createId: () => sensitive[2]!,
    });
    await coordinator.prepare(
      {
        playerId: "player-A",
        mediaEpoch: 1,
        localPath: sensitive[0]!,
        isNetworkResource: false,
      },
      { trackId: 7, origin: "embedded", codec: "ass", ffIndex: 3 },
    );
    const output = JSON.stringify(coordinator.view);
    expect(coordinator.view).toEqual({
      state: "failed",
      origin: "embedded",
      codec: "ass",
      canRetry: true,
      canReselect: true,
    });
    for (const value of sensitive) expect(output).not.toContain(value);
  });

  it("keeps detector samples, candidates, scores and exceptions out of results", () => {
    const sensitive = "PRIVATE_SUBTITLE_SAMPLE /private/media/title.srt";
    const cues: SubtitleCue[] = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      index,
      startMs: index * 1_000,
      endMs: index * 1_000 + 900,
      sourceText: `${sensitive} ${index}`,
      normalizedText: `${sensitive} ${index}`,
    }));
    const result = detectSubtitleLanguage(cues, {
      classifier: () => {
        throw new Error(`${sensitive} eng=1.0 fra=0.8 provider-secret`);
      },
    });
    expect(result).toEqual({ state: "unknown" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private|eng|fra|score|secret/);
  });

  it("keeps credentials, authorization and endpoints out of the shared translation task", () => {
    const sensitive = ["provider-secret", "Bearer private", "https://private.example/v1"];
    const task = buildTranslationTask({
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      targets: [
        {
          id: "c1",
          text: "required subtitle data",
          context_previous: "required previous data",
          context_next: "required next data",
        },
      ],
    });
    const output = JSON.stringify(task);

    expect(JSON.parse(task.userMessage)).toEqual({
      targets: [
        {
          id: "c1",
          text: "required subtitle data",
          context_previous: "required previous data",
          context_next: "required next data",
        },
      ],
    });
    for (const value of sensitive) expect(output).not.toContain(value);
  });
});
