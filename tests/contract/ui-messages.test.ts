import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GLOBAL_MESSAGE_NAMES,
  PROVIDER_ATTEMPT_EVENT_NAMES,
  SIDEBAR_MESSAGE_NAMES,
  parseProfileSelection,
  parseSecretSet,
  parseTargetLanguageSave,
  parseTargetLanguageSaved,
  parseLanguageOperationError,
  parseLanguageOperationResult,
  parseProviderModelsRequest,
  parseProviderModelsPreviewRequest,
  parseProviderModelsResult,
  sanitizedProfileView,
} from "../../src/domain/messages.js";
import { normalizeProviderError } from "../../src/domain/errors.js";
import { SESSION_STATUSES, USER_ACTIONS } from "../../src/domain/status.js";
import "../../ui/provider-status.js";

const providerTestStatusMessage = (
  globalThis as typeof globalThis & {
    subtandemProviderTestStatusMessage(result: {
      ok?: boolean;
      category?: string;
      userAction?: string;
      providerKind?: "openai" | "deepseek" | "ollama";
    }): string;
  }
).subtandemProviderTestStatusMessage;
const credentialStatusMessage = (
  globalThis as typeof globalThis & {
    subtandemCredentialStatusMessage(result: {
      state?: string;
      code?: string;
      userAction?: string;
    }): string;
  }
).subtandemCredentialStatusMessage;
const modelCatalogStatusMessage = (
  globalThis as typeof globalThis & {
    subtandemModelCatalogStatusMessage(result: {
      ok?: boolean;
      count?: number;
      category?: string;
      credentialSource?: "saved" | "entered" | "none";
    }): string;
  }
).subtandemModelCatalogStatusMessage;

describe("Sidebar/Main/Global security messages", () => {
  const sidebarSource = readFileSync(new URL("../../ui/sidebar.ts", import.meta.url), "utf8");
  const profile = {
    profileId: "00000000-0000-4000-8000-000000000001",
    revision: 2,
    displayName: "Remote",
    kind: "openai" as const,
    endpoint: "https://api.example.test/v1",
    endpointFingerprint: "fingerprint",
    model: "model",
    credential: { apiKey: "secret-value" },
  };

  it("returns sanitized views with exact kind/address and write-only credential state", () => {
    expect(sanitizedProfileView(profile)).toEqual({
      profileId: profile.profileId,
      revision: 2,
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      endpointFingerprint: "fingerprint",
      proxyMode: "system",
      model: "model",
      credentialConfigured: true,
    });
    expect(JSON.stringify(sanitizedProfileView(profile))).not.toContain("secret-value");
  });

  it("accepts DeepSeek model messages and exposes only a safe Profile view", () => {
    expect(
      parseProviderModelsRequest({
        requestId: "models-deepseek-1",
        revision: 1,
        payload: {
          trigger: "manual",
          kind: "deepseek",
          endpoint: "https://api.deepseek.com",
          proxyMode: "system",
        },
      }).payload.kind,
    ).toBe("deepseek");
    expect(
      parseProviderModelsPreviewRequest({
        requestId: "models-deepseek-preview-1",
        revision: 1,
        payload: {
          trigger: "manual",
          kind: "deepseek",
          endpoint: "https://api.deepseek.com",
          proxyMode: "direct",
          draftCredentialEpoch: 2,
          credential: { apiKey: "draft-secret" },
        },
      }).payload.kind,
    ).toBe("deepseek");
    const view = sanitizedProfileView({
      profileId: "deepseek-profile",
      revision: 2,
      displayName: "DeepSeek",
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      endpointFingerprint: "deepseek-fingerprint",
      credential: { apiKey: "saved-secret" },
    });
    expect(view).toMatchObject({ kind: "deepseek", credentialConfigured: true });
    expect(JSON.stringify(view)).not.toMatch(/saved-secret|apiKey|authorization/i);
  });

  it("rejects unknown and sensitive fields on DeepSeek model message boundaries", () => {
    const base = {
      requestId: "models-deepseek-invalid-1",
      revision: 1,
      payload: {
        trigger: "manual",
        kind: "deepseek",
        endpoint: "https://api.deepseek.com",
        proxyMode: "system",
      },
    };
    expect(() =>
      parseProviderModelsRequest({
        ...base,
        payload: { ...base.payload, apiKey: "must-not-cross" },
      }),
    ).toThrow(/INVALID_MESSAGE/);
    expect(() =>
      parseProviderModelsPreviewRequest({
        ...base,
        payload: {
          ...base.payload,
          draftCredentialEpoch: 1,
          credential: { apiKey: "draft-secret", Authorization: "Bearer draft-secret" },
        },
      }),
    ).toThrow(/INVALID_MESSAGE/);
  });

  it("accepts fresh write-only secrets and exact selection authorization only", () => {
    expect(
      parseSecretSet({
        profileId: profile.profileId,
        expectedRevision: 2,
        fields: { apiKey: "new-secret" },
      }),
    ).toEqual({
      profileId: profile.profileId,
      expectedRevision: 2,
      fields: { apiKey: "new-secret" },
    });
    expect(() =>
      parseSecretSet({
        profileId: profile.profileId,
        expectedRevision: 2,
        fields: { apiKey: "••••••" },
      }),
    ).toThrow(/MASKED_SECRET/);
    expect(
      parseProfileSelection({
        profileId: profile.profileId,
        revision: 2,
        endpointFingerprint: "fingerprint",
      }),
    ).toMatchObject({ revision: 2 });
  });

  it("uses a Main-owned profile deletion request and preserves only allowlisted provider errors", () => {
    expect(SIDEBAR_MESSAGE_NAMES).toContain("profile:delete-request");
    expect(
      normalizeProviderError({
        category: "authentication",
        retryable: false,
        statusCode: 401,
        providerCode: "invalid_api_key",
        userAction: "CHECK_CREDENTIALS",
        privateBody: "must-not-cross-rpc",
      }),
    ).toEqual({
      category: "authentication",
      retryable: false,
      statusCode: 401,
      providerCode: "invalid_api_key",
      userAction: "CHECK_CREDENTIALS",
    });
    expect(
      normalizeProviderError({
        category: "made-up",
        retryable: false,
        providerCode: "bad code with spaces",
        userAction: "LEAK_SECRET",
      }),
    ).toMatchObject({ providerCode: "UNKNOWN_PROVIDER_ERROR" });
  });

  it("turns safe provider classifications into actionable sidebar guidance", () => {
    expect(providerTestStatusMessage({ ok: true })).toBe("Connection test passed.");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "authentication",
        userAction: "CHECK_CREDENTIALS",
      }),
    ).toMatch(/API key/i);
    expect(
      providerTestStatusMessage({ ok: false, category: "model", userAction: "CHECK_MODEL" }),
    ).toMatch(/model/i);
    expect(
      providerTestStatusMessage({ ok: false, category: "quota", userAction: "CHECK_QUOTA" }),
    ).toMatch(/quota|billing/i);
    expect(
      providerTestStatusMessage({ ok: false, category: "timeout", userAction: "CHECK_NETWORK" }),
    ).toMatch(/timed out/i);
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "network",
        statusCode: 503,
        userAction: "CHECK_NETWORK",
      }),
    ).toMatch(/HTTP 503.*network route/i);
    expect(
      providerTestStatusMessage({
        ok: false,
        userAction: "CHECK_ENDPOINT",
        providerKind: "ollama",
      }),
    ).toMatch(/Ollama server URL.*chat support/i);
    expect(
      providerTestStatusMessage({
        ok: false,
        userAction: "CHECK_ENDPOINT",
        providerKind: "openai",
      }),
    ).toMatch(/OpenAI.*chat-completions/i);
  });

  it("distinguishes entered, saved and absent credentials in model refresh guidance", () => {
    expect(modelCatalogStatusMessage({ ok: true, count: 1 })).toBe("1 model available.");
    expect(modelCatalogStatusMessage({ ok: true, count: 3 })).toBe("3 models available.");
    expect(modelCatalogStatusMessage({ ok: true, count: 0 })).toBe(
      "No models were returned. Custom model ID remains available.",
    );
    expect(
      modelCatalogStatusMessage({
        ok: false,
        category: "authentication",
        credentialSource: "entered",
      }),
    ).toMatch(/entered API key/i);
    expect(
      modelCatalogStatusMessage({
        ok: false,
        category: "authentication",
        credentialSource: "saved",
      }),
    ).toMatch(/saved API key/i);
    expect(
      modelCatalogStatusMessage({
        ok: false,
        category: "authentication",
        credentialSource: "none",
      }),
    ).toMatch(/enter an API key/i);
  });

  it("uses exact translation-selection guidance without authorization wording", () => {
    expect(sidebarSource).toContain("Profile updated. Select it again for translation.");
    expect(providerTestStatusMessage({ ok: true })).not.toMatch(/select/i);
    expect(`${sidebarSource}\n${providerTestStatusMessage({ ok: true })}`).not.toContain(
      "to authorize translation",
    );
  });

  it("distinguishes helper and private-file credential failures", () => {
    expect(credentialStatusMessage({ state: "unavailable", code: "HELPER_UNAVAILABLE" })).toMatch(
      /not saved.*helper/i,
    );
    expect(
      credentialStatusMessage({ state: "unavailable", code: "CREDENTIAL_STORE_UNAVAILABLE" }),
    ).toMatch(/not saved.*private credential file/i);
    expect(credentialStatusMessage({ state: "ready" })).toMatch(/0600/i);
  });

  it("uses the current credential message contract", () => {
    expect(GLOBAL_MESSAGE_NAMES).toContain("profile:select");
    expect(GLOBAL_MESSAGE_NAMES).toContain("credential:set");
    expect(credentialStatusMessage({ state: "ready" })).toMatch(/private local file/i);
  });

  it("declares progressive provider events without exposing a credential channel", () => {
    expect(PROVIDER_ATTEMPT_EVENT_NAMES).toEqual([
      "provider:attempt-progress",
      "provider:attempt-result",
      "provider:attempt-error",
    ]);
    expect(JSON.stringify(PROVIDER_ATTEMPT_EVENT_NAMES)).not.toMatch(
      /secret|credential|authorization/i,
    );
  });

  it("accepts only target language in language save messages", () => {
    expect(
      parseTargetLanguageSave({
        requestId: "language-save-1",
        revision: 1,
        payload: { targetLanguage: "pt-PT" },
      }),
    ).toMatchObject({ payload: { targetLanguage: "pt-PT" } });
    for (const payload of [
      { targetLanguage: "invalid" },
      { targetLanguage: "en", sourceLanguage: "ja" },
      { targetLanguage: "en", sourceLanguageMode: "manual" },
    ])
      expect(() =>
        parseTargetLanguageSave({ requestId: "language-save-1", revision: 1, payload }),
      ).toThrow();
    expect(
      parseTargetLanguageSaved({ requestId: "language-save-1", targetLanguage: "pt-PT" }),
    ).toEqual({ requestId: "language-save-1", targetLanguage: "pt-PT" });
    expect(
      parseLanguageOperationError({
        requestId: "language-save-1",
        code: "TARGET_LANGUAGE_SAVE_FAILED",
        userAction: "NONE",
      }),
    ).toMatchObject({ code: "TARGET_LANGUAGE_SAVE_FAILED" });
    expect(
      parseLanguageOperationResult({
        requestId: "language-save-1",
        ok: true,
        action: "languages",
        targetLanguage: "pt-PT",
        targetLanguageRevision: 2,
      }),
    ).toMatchObject({ targetLanguageRevision: 2 });
  });

  it("publishes only fixed automatic detection states and removes manual confirmation", () => {
    expect(SESSION_STATUSES).toEqual(
      expect.arrayContaining([
        "detectingLanguage",
        "languageUnrecognized",
        "languageUnsupported",
        "noTranslationNeeded",
      ]),
    );
    expect(SESSION_STATUSES).not.toEqual(
      expect.arrayContaining(["waitingForLanguage", "nativeNoTranslation"]),
    );
    expect(USER_ACTIONS).not.toContain("CONFIRM_SOURCE_LANGUAGE");
  });

  it("keeps the provider test request and result message fields unchanged", () => {
    const request = {
      requestId: "request-id",
      revision: 2,
      payload: { profileId: profile.profileId, revision: 2 },
    };
    const result = {
      requestId: "request-id",
      ok: false,
      category: "quota",
      retryable: false,
      statusCode: 429,
      code: "insufficient_quota",
      userAction: "CHECK_QUOTA",
    };

    expect(Object.keys(request).sort()).toEqual(["payload", "requestId", "revision"]);
    expect(Object.keys(request.payload).sort()).toEqual(["profileId", "revision"]);
    expect(result).not.toHaveProperty("testId");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:test");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:test");
  });

  it("accepts only the strict model refresh request fields", () => {
    const message = {
      requestId: "models.window-a.1",
      revision: 2,
      payload: {
        trigger: "manual",
        kind: "ollama",
        endpoint: "https://models.example.test",
        proxyMode: "direct",
        profileId: profile.profileId,
        profileRevision: 2,
        endpointFingerprint: "fingerprint",
      },
    };
    expect(parseProviderModelsRequest(message)).toEqual(message);
    for (const forbidden of ["apiKey", "authorization", "model", "subtitle", "position"]) {
      expect(() =>
        parseProviderModelsRequest({
          ...message,
          payload: { ...message.payload, [forbidden]: "must-not-cross" },
        }),
      ).toThrow(/INVALID_MESSAGE/);
    }
    expect(() =>
      parseProviderModelsRequest({
        ...message,
        payload: { ...message.payload, profileRevision: undefined },
      }),
    ).toThrow(/INVALID_MESSAGE/);
  });

  it("accepts a write-only draft credential only in the manual preview message", () => {
    const message = {
      requestId: "models.preview.window-a.1",
      revision: 2,
      payload: {
        trigger: "manual",
        kind: "openai",
        endpoint: "https://models.example.test/v1",
        proxyMode: "system",
        draftCredentialEpoch: 3,
        credential: { apiKey: "draft-secret" },
      },
    };
    expect(parseProviderModelsPreviewRequest(message)).toEqual(message);
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:models-preview");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:models-preview");
    expect(() => parseProviderModelsRequest(message)).toThrow(/INVALID_MESSAGE/);
    for (const invalid of [
      { ...message.payload, trigger: "endpoint" },
      { ...message.payload, profileId: profile.profileId },
      { ...message.payload, model: "must-not-cross" },
      { ...message.payload, subtitle: "must-not-cross" },
      { ...message.payload, credential: { apiKey: "" } },
      { ...message.payload, credential: { apiKey: "x".repeat(8_193) } },
      { ...message.payload, credential: { apiKey: "draft-secret", token: "extra" } },
    ])
      expect(() => parseProviderModelsPreviewRequest({ ...message, payload: invalid })).toThrow(
        /INVALID_MESSAGE/,
      );
  });

  it("accepts only safe model refresh results", () => {
    expect(
      parseProviderModelsResult({
        requestId: "models.window-a.1",
        ok: true,
        contextKey: "opaque-context",
        models: ["model-a", "namespace/model:b"],
      }),
    ).toMatchObject({ ok: true, models: ["model-a", "namespace/model:b"] });
    expect(
      parseProviderModelsResult({
        requestId: "models.window-a.2",
        ok: false,
        contextKey: "opaque-context",
        category: "authentication",
        retryable: false,
        statusCode: 401,
        code: "invalid_api_key",
        userAction: "CHECK_CREDENTIALS",
      }),
    ).toMatchObject({ ok: false, category: "authentication" });
    for (const forbidden of ["apiKey", "authorization", "endpoint", "body", "subtitle"]) {
      expect(() =>
        parseProviderModelsResult({
          requestId: "models.window-a.3",
          ok: true,
          contextKey: "opaque-context",
          models: [],
          [forbidden]: "must-not-cross",
        }),
      ).toThrow(/INVALID_MESSAGE/);
    }
  });
});
