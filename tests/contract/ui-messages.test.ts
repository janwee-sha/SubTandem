import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GLOBAL_MESSAGE_NAMES,
  PROVIDER_ATTEMPT_EVENT_NAMES,
  SIDEBAR_MESSAGE_NAMES,
  parseProfileActivationGet,
  parseProfileActivationResult,
  parseProfileActivationSet,
  parseProfileActivationState,
  parseProfileDeleteRequest,
  parseProfileSelection,
  parseSecretSet,
  parseTargetLanguageSave,
  parseTargetLanguageSaved,
  parseLanguageOperationError,
  parseLanguageOperationResult,
  parseProviderModelsRequest,
  parseProviderModelsPreviewRequest,
  parseProviderModelsResult,
  parseProviderAttempt,
  parseProviderTestCancelRequest,
  parseProviderTestRequest,
  parseProviderTestResult,
  sanitizedProfileView,
} from "../../src/domain/messages.js";
import { normalizeProviderError } from "../../src/domain/errors.js";
import { SESSION_STATUSES, USER_ACTIONS } from "../../src/domain/status.js";
import "../../ui/service-failure-message.js";
import "../../ui/session-status.js";
import "../../ui/provider-status.js";
import { makeProviderRequest } from "./provider-test-helpers.js";

const providerTestStatusMessage = (
  globalThis as typeof globalThis & {
    subtandemProviderTestStatusMessage(result: {
      ok?: boolean;
      category?: string;
      statusCode?: number;
      code?: string;
      userAction?: string;
      providerKind?: "openai" | "claude" | "deepseek" | "ollama";
    }): string;
  }
).subtandemProviderTestStatusMessage;
const sessionFailureMessage = (
  globalThis as typeof globalThis & {
    subtandemSessionFailureMessage(result: {
      category?: string;
      statusCode?: number;
      providerCode?: string;
    }): string | null;
  }
).subtandemSessionFailureMessage;
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
  const providerStatusSource = readFileSync(
    new URL("../../ui/provider-status.ts", import.meta.url),
    "utf8",
  );
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

  it("accepts Claude only through the shared strict kind field and safe Profile view", () => {
    const request = {
      requestId: "models-claude-1",
      revision: 1,
      payload: {
        trigger: "manual" as const,
        kind: "claude" as const,
        endpoint: "https://api.anthropic.com",
        proxyMode: "system" as const,
      },
    };
    expect(parseProviderModelsRequest(request)).toEqual(request);
    const preview = {
      ...request,
      requestId: "models-claude-preview-1",
      payload: {
        ...request.payload,
        draftCredentialEpoch: 2,
        credential: { apiKey: "draft-secret" },
      },
    };
    expect(parseProviderModelsPreviewRequest(preview)).toEqual(preview);
    const view = sanitizedProfileView({
      profileId: "claude-profile",
      revision: 1,
      displayName: "Claude",
      kind: "claude",
      endpoint: "https://api.anthropic.com",
      endpointFingerprint: "fingerprint",
      credential: { apiKey: "saved-secret" },
    });
    expect(view).toMatchObject({ kind: "claude", credentialConfigured: true });
    expect(JSON.stringify(view)).not.toMatch(/saved-secret|apiKey|authorization/i);
    for (const field of ["apiKey", "authorization", "subtitle", "responseBody"])
      expect(() =>
        parseProviderModelsRequest({
          ...request,
          payload: { ...request.payload, [field]: "must-not-cross" },
        }),
      ).toThrow(/INVALID_MESSAGE/);
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
    const providerError = normalizeProviderError({
      category: "authentication",
      retryable: false,
      statusCode: 401,
      providerCode: "invalid_api_key",
      userAction: "CHECK_CREDENTIALS",
      body: "must-not-cross-rpc",
      credential: "must-not-cross-rpc",
      subtitle: "must-not-cross-rpc",
      endpoint: "https://private.example.test/v1",
      requestId: "private-request-id",
      logs: ["must-not-cross-rpc"],
    });
    expect(providerError).toEqual({
      category: "authentication",
      retryable: false,
      statusCode: 401,
      providerCode: "invalid_api_key",
      userAction: "CHECK_CREDENTIALS",
    });
    expect(Object.keys(providerError).sort()).toEqual([
      "category",
      "providerCode",
      "retryable",
      "statusCode",
      "userAction",
    ]);
    expect(JSON.stringify(providerError)).not.toMatch(/must-not-cross|private\.example/i);
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
    expect(providerTestStatusMessage({ ok: true })).toBe("Test passed");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "cancelled",
        code: "TEST_INVALIDATED",
        userAction: "RETRY",
      }),
    ).toBe("This test is no longer current. Review the Profile and test again.");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "protocol",
        code: "PROVIDER_TEST_FAILED",
        userAction: "CHECK_ENDPOINT",
        providerKind: "claude",
      }),
    ).toBe(
      "The translation service returned an unsupported response. Check the Profile’s service type and model.",
    );
    expect(providerStatusSource).toContain("subtandemServiceFailureMessage");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "authentication",
        userAction: "CHECK_CREDENTIALS",
      }),
    ).toBe("Authentication failed. Check the Profile’s API key.");
    expect(
      providerTestStatusMessage({ ok: false, category: "model", userAction: "CHECK_MODEL" }),
    ).toBe("The model is unavailable. Check the Profile’s Model ID.");
    expect(
      providerTestStatusMessage({ ok: false, category: "quota", userAction: "CHECK_QUOTA" }),
    ).toBe("The service limit was reached. Check the account quota or try again later.");
    expect(
      providerTestStatusMessage({ ok: false, category: "timeout", userAction: "CHECK_NETWORK" }),
    ).toBe("The translation service timed out. Try again.");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "network",
        statusCode: 503,
        userAction: "CHECK_NETWORK",
      }),
    ).toBe("Couldn’t reach the translation service. Check your connection and Network route.");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "configuration",
        userAction: "CHECK_ENDPOINT",
        providerKind: "ollama",
      }),
    ).toBe("The Profile settings were rejected. Check the Endpoint and Model ID.");
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "http",
        userAction: "CHECK_ENDPOINT",
        providerKind: "openai",
      }),
    ).toBe(
      "The translation service rejected the request. Check the Profile settings and try again.",
    );
    expect(
      providerTestStatusMessage({
        ok: false,
        category: "configuration",
        userAction: "CHECK_ENDPOINT",
        providerKind: "claude",
      }),
    ).toBe("The Profile settings were rejected. Check the Endpoint and Model ID.");
  });

  it("uses the same exact eleven service failure messages for Session and Profile Test", () => {
    const cases = [
      [
        { category: "authentication", userAction: "CHECK_CREDENTIALS" },
        "Authentication failed. Check the Profile’s API key.",
      ],
      [
        { category: "authentication", statusCode: 403, userAction: "CHECK_CREDENTIALS" },
        "Access was denied. Check the Profile’s API key and model access.",
      ],
      [
        { category: "configuration", userAction: "CHECK_ENDPOINT" },
        "The Profile settings were rejected. Check the Endpoint and Model ID.",
      ],
      [
        { category: "network", statusCode: 502, userAction: "CHECK_NETWORK" },
        "Couldn’t reach the translation service. Check your connection and Network route.",
      ],
      [
        { category: "timeout", userAction: "CHECK_NETWORK" },
        "The translation service timed out. Try again.",
      ],
      [
        { category: "model", userAction: "CHECK_MODEL" },
        "The model is unavailable. Check the Profile’s Model ID.",
      ],
      [
        { category: "quota", userAction: "CHECK_QUOTA" },
        "The service limit was reached. Check the account quota or try again later.",
      ],
      [
        { category: "refusal", userAction: "NONE" },
        "The translation service refused this request. Try another model or Profile.",
      ],
      [
        { category: "protocol", code: "INVALID_MESSAGE", userAction: "CHECK_ENDPOINT" },
        "The translation service returned an unsupported response. Check the Profile’s service type and model.",
      ],
      [
        { category: "http", statusCode: 400, userAction: "CHECK_ENDPOINT" },
        "The translation service rejected the request. Check the Profile settings and try again.",
      ],
      [
        { category: "protocol", code: "UNKNOWN_PROVIDER_ERROR", userAction: "NONE" },
        "Translation failed. Test the Profile and try again.",
      ],
    ] as const;

    for (const [input, expected] of cases) {
      expect(
        sessionFailureMessage({
          category: input.category,
          ...(input.statusCode === undefined ? {} : { statusCode: input.statusCode }),
          ...(input.code === undefined ? {} : { providerCode: input.code }),
        }),
      ).toBe(expected);
      expect(providerTestStatusMessage(input)).toBe(expected);
    }
  });

  it("keeps Profile Test-only lifecycle feedback outside the shared service mapper", () => {
    expect(providerTestStatusMessage({ ok: true })).toBe("Test passed");
    expect(
      providerTestStatusMessage({
        category: "cancelled",
        code: "TEST_INVALIDATED",
        userAction: "RETRY",
      }),
    ).toBe("This test is no longer current. Review the Profile and test again.");
    expect(providerTestStatusMessage({ category: "cancelled", userAction: "NONE" })).toBe("");
    expect(providerTestStatusMessage({ userAction: "RESTART_IINA" })).toMatch(
      /secure transport helper.*Restart IINA/i,
    );
    expect(providerTestStatusMessage({ userAction: "CHECK_INSTALLATION" })).toMatch(
      /transport helper.*reinstall/i,
    );
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
    expect(modelCatalogStatusMessage({ ok: false, category: "protocol" })).toMatch(
      /compatible model catalog.*custom model ID/i,
    );
  });

  it("uses exact translation-activation guidance without authorization wording", () => {
    expect(sidebarSource).toContain("Profile updated. Enable it when you are ready.");
    expect(providerTestStatusMessage({ ok: true })).toBe("Test passed");
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

  it("uses the global activation and credential message contract", () => {
    expect(GLOBAL_MESSAGE_NAMES).toContain("profile-activation:get");
    expect(GLOBAL_MESSAGE_NAMES).toContain("profile-activation:set");
    expect(GLOBAL_MESSAGE_NAMES).toContain("credential:set");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("profile-activation:set");
    expect(GLOBAL_MESSAGE_NAMES).not.toContain("profile:select");
    expect(GLOBAL_MESSAGE_NAMES).not.toContain("profile:release");
    expect(SIDEBAR_MESSAGE_NAMES).not.toContain("profile:select");
    expect(credentialStatusMessage({ state: "ready" })).toMatch(/private local file/i);
  });

  it("strictly parses activation requests, snapshots, results and delete confirmations", () => {
    const authority = {
      authorityId: "authority-1",
      stateVersion: 2,
      ready: true,
      activationGeneration: 3,
      activation: {
        profileId: profile.profileId,
        profileRevision: profile.revision,
        kind: profile.kind,
        endpointFingerprint: profile.endpointFingerprint,
        credentialConfigured: true,
      },
      profiles: [sanitizedProfileView(profile)],
    };
    const get = { requestId: "activation.get.1", revision: 1, payload: {} };
    const set = {
      requestId: "activation.set.1",
      revision: 1,
      payload: {
        authorityId: authority.authorityId,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        endpointFingerprint: profile.endpointFingerprint,
        enabled: true,
      },
    };
    const result = { requestId: set.requestId, outcome: "changed", authority };
    const deletion = {
      requestId: "profile.delete.1",
      revision: 1,
      payload: {
        profileId: profile.profileId,
        expectedRevision: profile.revision,
        displayName: profile.displayName,
      },
    };

    expect(parseProfileActivationGet(get)).toEqual(get);
    expect(parseProfileActivationSet(set)).toEqual(set);
    expect(parseProfileActivationState(authority)).toEqual(authority);
    expect(parseProfileActivationResult(result)).toEqual(result);
    expect(parseProfileDeleteRequest(deletion)).toEqual(deletion);

    for (const invalid of [
      { ...set, payload: { ...set.payload, enabled: "true" } },
      { ...set, payload: { ...set.payload, extra: true } },
      { ...set, payload: { ...set.payload, profileRevision: 0 } },
      { ...set, payload: { ...set.payload, authorityId: "" } },
    ])
      expect(() => parseProfileActivationSet(invalid)).toThrow(/INVALID_MESSAGE/);
    expect(() => parseProfileActivationState({ ...authority, credential: "secret" })).toThrow(
      /INVALID_MESSAGE/,
    );
    expect(() => parseProfileActivationResult({ ...result, outcome: "success" })).toThrow(
      /INVALID_MESSAGE/,
    );
    expect(() =>
      parseProfileDeleteRequest({ ...deletion, payload: { ...deletion.payload, extra: true } }),
    ).toThrow(/INVALID_MESSAGE/);
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

  it("accepts only an exact target-only provider attempt payload", () => {
    const request = makeProviderRequest();
    expect(
      parseProviderAttempt({ requestId: request.requestId, revision: 1, payload: request }),
    ).toEqual({ requestId: request.requestId, revision: 1, payload: request });

    for (const extra of [
      { sourceLanguage: "en" },
      { trackLanguage: "en" },
      { detectedLanguage: "en" },
      { languageDetection: "reliable" },
      { unknown: true },
    ])
      expect(() =>
        parseProviderAttempt({
          requestId: request.requestId,
          revision: 1,
          payload: { ...request, ...extra },
        }),
      ).toThrow();
  });

  it("validates provider attempt identity, target, item, and size boundaries", () => {
    const request = makeProviderRequest();
    const invalidPayloads = [
      { ...request, requestId: "different" },
      { ...request, sessionEpoch: -1 },
      { ...request, windowEpoch: 1.5 },
      { ...request, profileRevision: 0 },
      { ...request, targetLanguage: "invalid" },
      { ...request, items: [] },
      {
        ...request,
        items: Array.from({ length: 26 }, (_, index) => ({ id: `c${index}`, text: "x" })),
      },
      { ...request, items: [{ id: "c1", text: "x".repeat(5_001) }] },
      { ...request, items: [{ id: "c1", text: " " }] },
      { ...request, items: [{ id: "c1", text: "x", contextPrevious: "x".repeat(501) }] },
      {
        ...request,
        items: [
          { id: "same", text: "x" },
          { id: "same", text: "y" },
        ],
      },
      { ...request, items: [{ id: "c1", text: "x", sourceLanguage: "en" }] },
    ];
    for (const payload of invalidPayloads)
      expect(() =>
        parseProviderAttempt({ requestId: request.requestId, revision: 1, payload }),
      ).toThrow();
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

  it("publishes only actionable subtitle, configuration, running, and service states", () => {
    expect(SESSION_STATUSES).toEqual([
      "disabled",
      "waitingForSubtitle",
      "waitingForConfiguration",
      "preparing",
      "running",
      "partialFailure",
      "serviceUnavailable",
    ]);
    expect(USER_ACTIONS).not.toContain("CONFIRM_SOURCE_LANGUAGE");
  });

  it("accepts only strict draft provider Test, cancellation and safe result fields", () => {
    const request = {
      requestId: "request-id",
      revision: 2,
      payload: {
        drawerId: "drawer-id",
        draftRevision: 3,
        kind: "openai",
        endpoint: "https://api.example.test/v1",
        proxyMode: "direct",
        model: "model-a",
        sourceProfile: {
          profileId: profile.profileId,
          profileRevision: 2,
          endpointFingerprint: "fingerprint",
        },
        credential: { source: "saved" },
      },
    };
    const result = {
      requestId: "request-id",
      drawerId: "drawer-id",
      draftRevision: 3,
      ok: false,
      category: "quota",
      retryable: false,
      statusCode: 429,
      code: "PROVIDER_TEST_FAILED",
      userAction: "CHECK_QUOTA",
    };

    expect(parseProviderTestRequest(request)).toEqual(request);
    expect(
      parseProviderTestCancelRequest({
        requestId: "cancel-id",
        revision: 1,
        payload: { testRequestId: "request-id" },
      }),
    ).toMatchObject({ payload: { testRequestId: "request-id" } });
    expect(
      parseProviderTestCancelRequest({
        requestId: "close-id",
        revision: 1,
        payload: {},
      }),
    ).toMatchObject({ payload: {} });
    expect(parseProviderTestResult(result)).toEqual(result);
    expect(Object.keys(parseProviderTestResult(result)).sort()).toEqual([
      "category",
      "code",
      "draftRevision",
      "drawerId",
      "ok",
      "requestId",
      "retryable",
      "statusCode",
      "userAction",
    ]);
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:test");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:test-cancel");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:test");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:test-cancel");

    for (const forbidden of ["subtitle", "playerId", "displayName", "authorization", "testId"])
      expect(() =>
        parseProviderTestRequest({
          ...request,
          payload: { ...request.payload, [forbidden]: "must-not-cross" },
        }),
      ).toThrow("INVALID_MESSAGE");
    expect(() =>
      parseProviderTestRequest({
        ...request,
        payload: { ...request.payload, credential: { source: "entered", apiKey: "" } },
      }),
    ).toThrow("INVALID_MESSAGE");
    expect(() => parseProviderTestResult({ ...result, body: "private" })).toThrow(
      "INVALID_MESSAGE",
    );
    expect(() => parseProviderTestResult({ ...result, code: "provider_private_code" })).toThrow(
      "INVALID_MESSAGE",
    );
    for (const forbidden of [
      "message",
      "body",
      "responseBody",
      "credential",
      "apiKey",
      "subtitle",
      "endpoint",
      "providerKind",
      "providerName",
      "diagnostic",
    ])
      expect(() => parseProviderTestResult({ ...result, [forbidden]: "must-not-cross" })).toThrow(
        "INVALID_MESSAGE",
      );
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

describe("precise model cancellation", () => {
  it("accepts only an exact model ID or the window close payload", async () => {
    const { parseProviderModelsCancelRequest } = await import("../../src/domain/messages.js");
    for (const payload of [{}, { modelRequestId: "model.1-a_b" }])
      expect(
        parseProviderModelsCancelRequest({ requestId: "cancel", revision: 1, payload }).payload,
      ).toEqual(payload);
    for (const payload of [
      { playerId: "other" },
      { modelRequestId: "" },
      { modelRequestId: "a".repeat(129) },
      { modelRequestId: "a/b" },
      { modelRequestId: "valid", unknown: "secret" },
    ])
      expect(() =>
        parseProviderModelsCancelRequest({ requestId: "cancel", revision: 1, payload }),
      ).toThrow("INVALID_MESSAGE");
  });
});
