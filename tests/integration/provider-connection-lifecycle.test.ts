import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "../../src/domain/errors.js";
import { ProviderBroker } from "../../src/providers/broker.js";
import { ProviderConnectionTests } from "../../src/providers/connection-tests.js";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { ModelCatalogSync } from "../../src/adapters/iina/model-catalog-sync.js";
import type { TranslationBatchRequest, TranslationBatchResult } from "../../src/providers/types.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";
import {
  activateTestProfile,
  authorizedProviderRequest,
  createTestProfileAuthority,
} from "../helpers/profile-activation-harness.js";
import "../../ui/service-failure-message.js";
import "../../ui/session-status.js";
import "../../ui/provider-status.js";

const providerTestStatusMessage = (
  globalThis as typeof globalThis & {
    subtandemProviderTestStatusMessage(result: {
      category?: string;
      statusCode?: number;
      code?: string;
      userAction?: string;
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

class DeferredConfiguredProvider implements ConfiguredProvider {
  readonly attemptIds: string[] = [];
  readonly testIds: string[] = [];
  readonly cancelledIds: string[] = [];
  private readonly attempts = new Map<
    string,
    {
      resolve: (result: TranslationBatchResult) => void;
      reject: (error: unknown) => void;
    }
  >();
  private readonly tests = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: unknown) => void }
  >();

  attempt(request: TranslationBatchRequest): Promise<TranslationBatchResult> {
    this.attemptIds.push(request.requestId);
    return new Promise((resolve, reject) => {
      this.attempts.set(request.requestId, { resolve, reject });
    });
  }

  testConnection(testId: string): Promise<unknown> {
    this.testIds.push(testId);
    return new Promise((resolve, reject) => {
      this.tests.set(testId, { resolve, reject });
    });
  }

  cancel(id: string): void {
    this.cancelledIds.push(id);
    const error = { category: "cancelled", retryable: false };
    this.attempts.get(id)?.reject(error);
    this.tests.get(id)?.reject(error);
    this.attempts.delete(id);
    this.tests.delete(id);
  }

  resolveAttempt(id: string, text: string): void {
    this.attempts.get(id)?.resolve({ translations: [{ id: "c1", text }] });
    this.attempts.delete(id);
  }

  resolveTest(id: string): void {
    this.tests.get(id)?.resolve({ ok: true });
    this.tests.delete(id);
  }
}

describe("provider connection lifecycle integration", () => {
  it("runs fixed draft probes for all providers without Profile or subtitle side effects", async () => {
    const requests: ProviderTransportRequest[] = [];
    const transport = {
      request: async (request: ProviderTransportRequest) => {
        requests.push(request);
        if (request.url.endsWith("/api/version"))
          return { statusCode: 200, headers: {}, bodyText: '{"version":"test"}' };
        if (request.url.endsWith("/api/tags"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: '{"models":[{"model":"draft-ollama"}]}',
          };
        const body = request.body as { messages: Array<{ content: string }> };
        const content = body.messages.at(-1)!.content;
        const delimited = /INPUT_JSON_BEGIN\n([\s\S]*?)\nINPUT_JSON_END/.exec(content);
        const targets = (
          JSON.parse(delimited?.[1] ?? content) as { targets: Array<{ id: string }> }
        ).targets;
        const translated = JSON.stringify({
          translations: targets.map(({ id }) => ({ id, text: `T:${id}` })),
        });
        if (request.url.includes("anthropic.com"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              type: "message",
              role: "assistant",
              stop_reason: "end_turn",
              content: [{ type: "text", text: translated }],
            }),
          };
        if (request.url.endsWith("/api/chat"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({ message: { content: translated } }),
          };
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: translated } }],
          }),
        };
      },
    };
    const providers: ConfiguredProvider[] = [
      new OpenAICompatibleProvider(
        {
          endpoint: "https://openai.example/v1",
          model: "draft-openai",
          apiKey: "entered-openai-key",
          proxyMode: "direct",
          sessionId: "draft-session",
        },
        transport,
      ),
      new ClaudeProvider(
        {
          endpoint: "https://api.anthropic.com",
          model: "draft-claude",
          apiKey: "entered-claude-key",
          proxyMode: "direct",
        },
        transport,
      ),
      new DeepSeekProvider(
        {
          endpoint: "https://api.deepseek.com",
          model: "draft-deepseek",
          apiKey: "entered-deepseek-key",
          proxyMode: "direct",
        },
        transport,
      ),
      new OllamaProvider(
        {
          endpoint: "http://127.0.0.1:11434",
          model: "draft-ollama",
          proxyMode: "direct",
        },
        transport,
      ),
    ];
    const profiles = new ProviderProfiles(() => "unused-profile");

    for (const [index, provider] of providers.entries())
      await expect(provider.testConnection(`draft-test-${index}`)).resolves.toBeDefined();

    expect(profiles.listLatest()).toEqual([]);
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.proxyMode === "direct")).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("currently-playing-private-subtitle");
    expect(
      requests
        .filter((request) => request.body)
        .map((request) => (request.body as { model?: string }).model),
    ).toEqual(["draft-openai", "draft-claude", "draft-deepseek", "draft-ollama"]);
  });

  it("projects unavailable-model failures from every Provider identically in Test and Session", async () => {
    const openAIResponse = {
      statusCode: 400,
      headers: {},
      bodyText: JSON.stringify({
        error: {
          code: "invalid_request_error",
          message: "The requested model does not exist: PRIVATE_MODEL_RESPONSE",
        },
      }),
    };
    const claudeResponse = {
      statusCode: 400,
      headers: {},
      bodyText: JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "The requested model is not supported: PRIVATE_MODEL_RESPONSE",
        },
      }),
    };
    const deepSeekResponse = {
      statusCode: 400,
      headers: {},
      bodyText: JSON.stringify({
        error: {
          type: "invalid_request_error",
          code: "invalid_request_error",
          message: "Model Not Exist: PRIVATE_MODEL_RESPONSE",
        },
      }),
    };
    const providers: ConfiguredProvider[] = [
      new OpenAICompatibleProvider(
        {
          endpoint: "https://openai.example/v1",
          model: "private-model",
          capability: "prompt-json",
          sessionId: "session",
        },
        { request: async () => openAIResponse },
      ),
      new ClaudeProvider(
        {
          endpoint: "https://api.anthropic.com",
          model: "private-model",
          apiKey: "fictional-key",
        },
        { request: async () => claudeResponse },
      ),
      new DeepSeekProvider(
        { endpoint: "https://api.deepseek.com", model: "private-model" },
        { request: async () => deepSeekResponse },
      ),
      new OllamaProvider(
        { endpoint: "http://127.0.0.1:11434", model: "private-model" },
        {
          request: async (request) => {
            if (request.url.endsWith("/api/version"))
              return {
                statusCode: 200,
                headers: {},
                bodyText: '{"version":"0.10"}',
              };
            if (request.url.endsWith("/api/tags"))
              return {
                statusCode: 200,
                headers: {},
                bodyText: '{"models":[]}',
              };
            return {
              statusCode: 404,
              headers: {},
              bodyText: JSON.stringify({
                error: "model 'private-model' not found: PRIVATE_MODEL_RESPONSE",
              }),
            };
          },
        },
      ),
    ];
    const expected = "The model is unavailable. Check the Profile’s Model ID.";

    for (const [index, provider] of providers.entries()) {
      const testError = normalizeProviderError(
        await provider.testConnection(`unavailable-model-${index}`).catch((error) => error),
      );
      const sessionError = normalizeProviderError(
        await provider.attempt(makeProviderRequest()).catch((error) => error),
      );
      const testWire = {
        category: testError.category,
        ...(testError.statusCode === undefined ? {} : { statusCode: testError.statusCode }),
        code: testError.category === "model" ? "MODEL_REQUIRED" : "PROVIDER_TEST_FAILED",
        userAction: testError.userAction,
      };

      expect(testError.category).toBe("model");
      expect(sessionError.category).toBe("model");
      expect(providerTestStatusMessage(testWire)).toBe(expected);
      expect(sessionFailureMessage(sessionError)).toBe(expected);
      expect(JSON.stringify({ testWire, sessionError })).not.toMatch(
        /PRIVATE_MODEL_RESPONSE|invalid_request_error|private-model/,
      );
    }
  });

  it("runs Claude Save, fresh Test, activation, translation, Update and Delete", async () => {
    const requests: ProviderTransportRequest[] = [];
    const profiles = new ProviderProfiles(() => "claude-profile");
    const created = profiles.save({
      displayName: "Claude",
      kind: "claude",
      endpoint: "https://api.anthropic.com",
      model: "exact-model",
    });
    const provider = new ClaudeProvider(
      { endpoint: created.endpoint, model: created.model!, apiKey: "fictional-key" },
      {
        request: async (request) => {
          requests.push(request);
          const targets = JSON.parse(
            (request.body as { messages: Array<{ content: string }> }).messages[0]!.content,
          ).targets as Array<{ id: string }>;
          return {
            statusCode: 200,
            headers: {},
            bodyText: JSON.stringify({
              type: "message",
              role: "assistant",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    translations: targets.map((target) => ({ id: target.id, text: "translated" })),
                  }),
                },
              ],
            }),
          };
        },
      },
    );
    const tests = new ProviderConnectionTests(() => "claude-fresh-test");
    const started = tests.begin({
      senderId: "window-a",
      requestId: "test-request",
      drawerId: "drawer-claude",
      draftRevision: 1,
      sourceProfile: {
        profileId: created.profileId,
        profileRevision: created.revision,
        endpointFingerprint: created.endpointFingerprint,
      },
      credentialEpoch: 1,
    });
    expect(started).not.toBeNull();
    const task = started!.owner;
    expect(tests.attachProvider(task, provider)).toBe(task);
    await provider.testConnection(task.testId);
    tests.complete(task);
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, created, "window-a");
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      profileId: created.profileId,
      profileRevision: created.revision,
      endpointFingerprint: created.endpointFingerprint,
    });
    await expect(broker.attempt("window-a", request)).resolves.toMatchObject({
      translations: [
        { id: "c1", text: "translated" },
        { id: "c2", text: "translated" },
      ],
    });
    const updated = profiles.save({
      profileId: created.profileId,
      expectedRevision: created.revision,
      editingWindowId: "window-a",
      displayName: "Claude updated",
      kind: "claude",
      endpoint: created.endpoint,
      model: "next-model",
    });
    expect(updated.revision).toBe(2);
    expect(profiles.get(created.profileId, created.revision)).toBeNull();
    profiles.delete(created.profileId);
    expect(profiles.get(created.profileId)).toBeNull();
    expect(requests.map((item) => item.url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.anthropic.com/v1/messages",
    ]);
  });

  it("keeps only latest revisions and leaves unrelated Profiles unchanged", () => {
    let sequence = 0;
    const profiles = new ProviderProfiles(() => `deepseek-${++sequence}`);
    const deepseek = profiles.save({
      displayName: "DeepSeek",
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      model: "exact-model",
    });
    const retained = profiles.save({
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://api.example.test/v1",
      model: "model",
    });
    const updated = profiles.save({
      profileId: deepseek.profileId,
      expectedRevision: deepseek.revision,
      editingWindowId: "window-a",
      displayName: "DeepSeek updated",
      kind: "deepseek",
      endpoint: deepseek.endpoint,
      model: deepseek.model,
    });
    expect(profiles.get(deepseek.profileId, deepseek.revision)).toBeNull();
    expect(profiles.get(updated.profileId, updated.revision)).toEqual(updated);
    profiles.delete(deepseek.profileId);
    expect(profiles.get(deepseek.profileId)).toBeNull();
    expect(profiles.get(retained.profileId)).toEqual(retained);
  });

  it("does not let model refresh ownership alter the saved translation profile", () => {
    const profiles = new ProviderProfiles(() => "profile-model-sync");
    const profile = profiles.save({
      displayName: "Selected",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "selected-model",
    });
    const sync = new ModelCatalogSync();
    sync.begin("window-a", {
      requestId: "models-1",
      contextToken: "profile-context",
      trigger: "manual",
    });
    sync.commit("window-a", {
      requestId: "models-1",
      ok: true,
      contextKey: "opaque",
      models: ["different-model"],
    });
    expect(profiles.get(profile.profileId, profile.revision)).toEqual(profile);
    expect(profiles.get(profile.profileId)?.model).toBe("selected-model");
  });

  it("preserves known, custom and disappeared model IDs as the exact profile value", () => {
    let sequence = 0;
    const profiles = new ProviderProfiles(() => `model-profile-${++sequence}`);
    const known = profiles.save({
      displayName: "Known",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "namespace/model:v2",
    });
    const custom = profiles.save({
      displayName: "Custom",
      kind: "ollama",
      endpoint: "https://ollama.example.test",
      model: "  exact-Custom:7b  ",
    });
    const disappeared = profiles.save({
      profileId: known.profileId,
      expectedRevision: known.revision,
      displayName: known.displayName,
      kind: known.kind,
      endpoint: known.endpoint,
      model: known.model,
    });

    expect(profiles.get(known.profileId)?.model).toBe("namespace/model:v2");
    expect(custom.model).toBe("exact-Custom:7b");
    expect(disappeared.model).toBe("namespace/model:v2");
  });

  it("isolates colliding window translations and connection tests through cancellation", async () => {
    let profileSequence = 0;
    let testSequence = 0;
    const profiles = new ProviderProfiles(() => `profile-${++profileSequence}`);
    const provider = new DeferredConfiguredProvider();
    const tests = new ProviderConnectionTests(() => `test-${++testSequence}`);
    const sharedProfile = profiles.save({
      displayName: "Shared",
      kind: "openai",
      endpoint: "https://shared.example/v1",
      model: "model",
    });
    const retainedProfile = profiles.save({
      displayName: "Retained",
      kind: "openai",
      endpoint: "https://retained.example/v1",
      model: "model",
    });
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, sharedProfile);
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      requestId: "same-request" as ReturnType<typeof makeProviderRequest>["requestId"],
      profileId: sharedProfile.profileId,
      profileRevision: sharedProfile.revision,
      endpointFingerprint: sharedProfile.endpointFingerprint,
    });
    const attemptA = broker.attempt("player-a", request);
    const attemptB = broker.attempt("player-b", request);
    void attemptA.catch(() => undefined);
    const startedA = tests.begin({
      senderId: "player-a",
      requestId: "same-request",
      drawerId: "drawer-a",
      draftRevision: 1,
      sourceProfile: {
        profileId: sharedProfile.profileId,
        profileRevision: sharedProfile.revision,
        endpointFingerprint: sharedProfile.endpointFingerprint,
      },
      credentialEpoch: 1,
    });
    const startedB = tests.begin({
      senderId: "player-b",
      requestId: "same-request",
      drawerId: "drawer-b",
      draftRevision: 1,
      sourceProfile: {
        profileId: retainedProfile.profileId,
        profileRevision: retainedProfile.revision,
        endpointFingerprint: retainedProfile.endpointFingerprint,
      },
      credentialEpoch: 1,
    });
    expect(startedA).not.toBeNull();
    expect(startedB).not.toBeNull();
    const testA = startedA!.owner;
    const testB = startedB!.owner;
    tests.attachProvider(testA, provider);
    tests.attachProvider(testB, provider);
    const testPendingA = provider.testConnection(testA.testId);
    const testPendingB = provider.testConnection(testB.testId);
    void testPendingA.catch(() => undefined);
    await Promise.resolve();

    expect(new Set(provider.attemptIds).size).toBe(2);
    expect(new Set([...provider.attemptIds, ...provider.testIds]).size).toBe(4);

    await broker.cancel("player-a", request.requestId);
    await tests.invalidateProfile(sharedProfile.profileId);

    await expect(attemptA).rejects.toMatchObject({ category: "cancelled" });
    await expect(testPendingA).rejects.toMatchObject({ category: "cancelled" });
    expect(tests.complete(testA)).toBeNull();
    const remainingAttemptId = provider.attemptIds.find(
      (id) => !provider.cancelledIds.includes(id),
    );
    expect(remainingAttemptId).toBeDefined();
    provider.resolveAttempt(remainingAttemptId!, "player-b-result");
    provider.resolveTest(testB.testId);

    await expect(attemptB).resolves.toMatchObject({
      translations: [{ text: "player-b-result" }],
    });
    await expect(testPendingB).resolves.toEqual({ ok: true });
    expect(tests.complete(testB)).toEqual(testB);
    expect(tests.activeCount()).toBe(0);
  });
});
