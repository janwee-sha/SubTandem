import { describe, expect, it } from "vitest";
import { ProviderBroker } from "../../src/providers/broker.js";
import { ProviderConnectionTests } from "../../src/providers/connection-tests.js";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { ModelCatalogSync } from "../../src/adapters/iina/model-catalog-sync.js";
import type { TranslationBatchRequest, TranslationBatchResult } from "../../src/providers/types.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";

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
  it("runs Claude Save, fresh Test, Select, translation, Update and Delete across owners", async () => {
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
    const task = tests.start({
      playerId: "window-a",
      requestId: "test-request",
      profileId: created.profileId,
      profileRevision: created.revision,
      provider,
    });
    await provider.testConnection(task.testId);
    tests.complete(task.testId);
    expect(profiles.selection("window-a")).toBeNull();

    const broker = new ProviderBroker(profiles, () => provider);
    broker.select("window-a", created.profileId, created.revision, created.endpointFingerprint);
    const request = {
      ...makeProviderRequest(),
      profileId: created.profileId,
      profileRevision: created.revision,
      endpointFingerprint: created.endpointFingerprint,
    };
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
    expect(profiles.selection("window-a")).toBeNull();
    profiles.delete(created.profileId);
    expect(profiles.get(created.profileId)).toBeNull();
    expect(requests.map((item) => item.url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.anthropic.com/v1/messages",
    ]);
  });

  it("invalidates only the edited or deleted DeepSeek Profile selection", () => {
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
    profiles.select(
      "window-a",
      deepseek.profileId,
      deepseek.revision,
      deepseek.endpointFingerprint,
    );
    profiles.select(
      "window-b",
      retained.profileId,
      retained.revision,
      retained.endpointFingerprint,
    );
    profiles.save({
      profileId: deepseek.profileId,
      expectedRevision: deepseek.revision,
      editingWindowId: "window-a",
      displayName: "DeepSeek updated",
      kind: "deepseek",
      endpoint: deepseek.endpoint,
      model: deepseek.model,
    });
    expect(profiles.selection("window-a")).toBeNull();
    expect(profiles.selection("window-b")).toMatchObject({ profileId: retained.profileId });
    profiles.delete(deepseek.profileId);
    expect(profiles.get(deepseek.profileId)).toBeNull();
    expect(profiles.get(retained.profileId)).toEqual(retained);
  });

  it("does not let model refresh ownership alter the selected translation profile", () => {
    const profiles = new ProviderProfiles(() => "profile-model-sync");
    const profile = profiles.save({
      displayName: "Selected",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "selected-model",
    });
    profiles.select("window-a", profile.profileId, profile.revision, profile.endpointFingerprint);
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
    expect(profiles.selection("window-a")).toMatchObject({
      profileId: profile.profileId,
      revision: profile.revision,
    });
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
    const broker = new ProviderBroker(profiles, () => provider);
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
    for (const playerId of ["player-a", "player-b"])
      broker.select(
        playerId,
        sharedProfile.profileId,
        sharedProfile.revision,
        sharedProfile.endpointFingerprint,
      );
    const request = {
      ...makeProviderRequest(),
      requestId: "same-request" as ReturnType<typeof makeProviderRequest>["requestId"],
      profileId: sharedProfile.profileId,
      profileRevision: sharedProfile.revision,
      endpointFingerprint: sharedProfile.endpointFingerprint,
    };
    const attemptA = broker.attempt("player-a", request);
    const attemptB = broker.attempt("player-b", request);
    void attemptA.catch(() => undefined);
    const testA = tests.start({
      playerId: "player-a",
      requestId: "same-request",
      profileId: sharedProfile.profileId,
      profileRevision: sharedProfile.revision,
      provider,
    });
    const testB = tests.start({
      playerId: "player-b",
      requestId: "same-request",
      profileId: retainedProfile.profileId,
      profileRevision: retainedProfile.revision,
      provider,
    });
    const testPendingA = provider.testConnection(testA.testId);
    const testPendingB = provider.testConnection(testB.testId);
    void testPendingA.catch(() => undefined);
    await Promise.resolve();

    expect(new Set(provider.attemptIds).size).toBe(2);
    expect(new Set([...provider.attemptIds, ...provider.testIds]).size).toBe(4);

    await broker.cancel("player-a", request.requestId);
    await tests.cancelProfile(sharedProfile.profileId);

    await expect(attemptA).rejects.toMatchObject({ category: "cancelled" });
    await expect(testPendingA).rejects.toMatchObject({ category: "cancelled" });
    expect(tests.complete(testA.testId)).toBeNull();
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
    expect(tests.complete(testB.testId)).toEqual(testB);
    expect(tests.activeCount()).toBe(0);
  });
});
