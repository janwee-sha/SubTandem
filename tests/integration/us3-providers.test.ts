import { describe, expect, it } from "vitest";
import { ProviderBroker } from "../../src/providers/broker.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { OpenAICompatibleProvider } from "../../src/providers/openai.js";
import { OllamaProvider } from "../../src/providers/ollama.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { TranslationProvider } from "../../src/providers/provider.js";
import type { ProviderTransport } from "../../src/providers/transport.js";
import {
  acceptProfileListResult,
  beginProfileListRequest,
  createProfileListSyncState,
  removeDeletedProfile,
} from "../../src/adapters/iina/profile-list-sync.js";
import "../../ui/sidebar-state.js";
import { makeProviderRequest } from "../contract/provider-test-helpers.js";
import { discoverProviderModels } from "../../src/providers/model-discovery.js";
import { CredentialScopedProviderCache } from "../../src/providers/provider-cache.js";
import {
  ModelCatalogSync,
  modelCatalogContextToken,
} from "../../src/adapters/iina/model-catalog-sync.js";
import {
  activateTestProfile,
  authorizedProviderRequest,
  createTestProfileAuthority,
} from "../helpers/profile-activation-harness.js";

function parseTranslationPayload(content: string): {
  targets: Array<{ id: string; text?: string }>;
} {
  const delimited = /INPUT_JSON_BEGIN\n([\s\S]*?)\nINPUT_JSON_END/.exec(content);
  return JSON.parse(delimited?.[1] ?? content) as {
    targets: Array<{ id: string; text?: string }>;
  };
}

describe("US3 provider broker integration", () => {
  it("keeps four Provider kinds coexisting with one exact global activation", async () => {
    let sequence = 0;
    const profiles = new ProviderProfiles(() => `profile-${++sequence}`);
    const saved = [
      profiles.save({
        displayName: "OpenAI",
        kind: "openai",
        endpoint: "https://openai.example/v1",
        model: "openai-model",
      }),
      profiles.save({
        displayName: "Claude",
        kind: "claude",
        endpoint: "https://api.anthropic.com",
        model: "claude-model",
      }),
      profiles.save({
        displayName: "DeepSeek",
        kind: "deepseek",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-model",
      }),
      profiles.save({
        displayName: "Ollama",
        kind: "ollama",
        endpoint: "http://127.0.0.1:11434",
        model: "ollama-model",
      }),
    ];
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: request.items.map((item) => ({ id: item.id, text: "current-window" })),
      }),
    };
    const claude = saved[1]!;
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, claude, "window-claude");
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      profileId: claude.profileId,
      profileRevision: claude.revision,
      endpointFingerprint: claude.endpointFingerprint,
    });

    await expect(broker.attempt("window-claude", request)).resolves.toMatchObject({
      translations: [{ text: "current-window" }, { text: "current-window" }],
    });
    expect(profiles.listLatest().map((profile) => profile.kind)).toEqual([
      "openai",
      "claude",
      "deepseek",
      "ollama",
    ]);
    await expect(
      broker.attempt("forged", { ...request, endpointFingerprint: "forged" }),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ACTIVE" });

    const transport: ProviderTransport = {
      request: async (wire) => ({
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
                translations: (
                  JSON.parse(
                    (wire.body as { messages: Array<{ content: string }> }).messages[0]!.content,
                  ) as { targets: Array<{ id: string }> }
                ).targets.map((target) => ({ id: target.id, text: "claude" })),
              }),
            },
          ],
        }),
      }),
    };
    const actualClaude = new ClaudeProvider(
      { endpoint: claude.endpoint, model: claude.model!, apiKey: "fictional-key" },
      transport,
    );
    await expect(actualClaude.attempt(request)).resolves.toMatchObject({
      translations: [{ text: "claude" }, { text: "claude" }],
    });
  });

  it("rejects late DeepSeek model results across kind, revision and window owners", () => {
    const sync = new ModelCatalogSync();
    const deepseekContext = modelCatalogContextToken({
      trigger: "manual",
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      proxyMode: "system",
      profileId: "deepseek-profile",
      profileRevision: 1,
      endpointFingerprint: "deepseek-fingerprint",
    });
    sync.begin("window-a", {
      requestId: "deepseek-old",
      contextToken: deepseekContext,
      trigger: "manual",
    });
    sync.begin("window-a", {
      requestId: "openai-current",
      contextToken: modelCatalogContextToken({
        trigger: "profile",
        kind: "openai",
        endpoint: "https://api.example.test/v1",
        proxyMode: "direct",
      }),
      trigger: "profile",
    });
    sync.begin("window-b", {
      requestId: "deepseek-window-b",
      contextToken: deepseekContext,
      trigger: "manual",
    });
    expect(
      sync.commit("window-a", {
        requestId: "deepseek-old",
        ok: true,
        contextKey: "stale",
        models: ["stale-model"],
      }),
    ).toBe(false);
    expect(sync.snapshot("window-a").catalog).toBeNull();
    expect(sync.snapshot("window-b").ownerRequestId).toBe("deepseek-window-b");
  });

  it("runs DeepSeek Refresh, fresh Test, activation and translation without Test activating it", async () => {
    const paths: string[] = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        paths.push(new URL(request.url).pathname);
        if (request.url.endsWith("/models"))
          return { statusCode: 200, headers: {}, bodyText: '{"data":[{"id":"exact-model"}]}' };
        const targets = JSON.parse(
          (request.body as { messages: Array<{ content: string }> }).messages.at(-1)!.content,
        ).targets as Array<{ id: string; text: string }>;
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    translations: targets.map((target) => ({
                      id: target.id,
                      text: `T:${target.text}`,
                    })),
                  }),
                },
              },
            ],
          }),
        };
      },
    };
    await expect(
      discoverProviderModels(
        { jobId: "deepseek-refresh", kind: "deepseek", endpoint: "https://api.deepseek.com" },
        transport,
      ),
    ).resolves.toEqual(["exact-model"]);
    const profiles = new ProviderProfiles(() => "deepseek-profile");
    const saved = profiles.save({
      displayName: "DeepSeek",
      kind: "deepseek",
      endpoint: "https://api.deepseek.com",
      model: "exact-model",
    });
    const createProvider = () =>
      new DeepSeekProvider({ endpoint: saved.endpoint, model: saved.model! }, transport);
    await expect(createProvider().testConnection("deepseek-test")).resolves.toBeDefined();
    const authority = createTestProfileAuthority(profiles);
    const broker = new ProviderBroker(profiles, authority, createProvider);
    expect(authority.snapshot.activation).toBeNull();
    await activateTestProfile(authority, saved, "window");
    await expect(
      broker.attempt(
        "window",
        authorizedProviderRequest(authority, {
          ...makeProviderRequest(),
          profileId: saved.profileId,
          profileRevision: saved.revision,
          endpointFingerprint: saved.endpointFingerprint,
        }),
      ),
    ).resolves.toMatchObject({ translations: [{ id: "c1" }, { id: "c2" }] });
    expect(paths).toEqual(["/models", "/chat/completions", "/chat/completions"]);
  });

  it("uses one Ollama Bearer for Refresh, Test and translation", async () => {
    const paths: string[] = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        if (request.headers.Authorization !== "Bearer remote-secret")
          return { statusCode: 401, headers: {}, bodyText: "{}" };
        paths.push(new URL(request.url).pathname);
        if (request.url.endsWith("/api/version"))
          return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
        if (request.url.endsWith("/api/tags"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: '{"models":[{"model":"qwen","name":"qwen"}]}',
          };
        const targets = parseTranslationPayload(
          (request.body as { messages: Array<{ content: string }> }).messages.at(-1)!.content,
        ).targets;
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            message: {
              content: JSON.stringify({
                translations: targets.map((target) => ({ id: target.id, text: "T" })),
              }),
            },
          }),
        };
      },
    };
    await expect(
      discoverProviderModels(
        {
          jobId: "refresh",
          kind: "ollama",
          endpoint: "https://ollama.example.test",
          apiKey: "remote-secret",
        },
        transport,
      ),
    ).resolves.toEqual(["qwen"]);
    const provider = new OllamaProvider(
      {
        endpoint: "https://ollama.example.test",
        model: "qwen",
        apiKey: "remote-secret",
      },
      transport,
    );
    await provider.testConnection("test");
    await provider.attempt(makeProviderRequest());
    expect(paths).toEqual([
      "/api/tags",
      "/api/version",
      "/api/tags",
      "/api/chat",
      "/api/chat",
      "/api/chat",
    ]);
  });

  it("uses one Bearer with prompt-only JSON across official Ollama Cloud flows", async () => {
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const transport: ProviderTransport = {
      request: async (request) => {
        expect(request.headers.Authorization).toBe("Bearer cloud-secret");
        requests.push({
          path: new URL(request.url).pathname,
          ...(request.body ? { body: request.body as Record<string, unknown> } : {}),
        });
        if (request.url.endsWith("/api/version"))
          return { statusCode: 200, headers: {}, bodyText: '{"version":"cloud"}' };
        if (request.url.endsWith("/api/tags"))
          return {
            statusCode: 200,
            headers: {},
            bodyText: '{"models":[{"model":"cloud-model"}]}',
          };
        const messages = (request.body as { messages: Array<{ content: string }> }).messages;
        const targets = parseTranslationPayload(messages.at(-1)!.content).targets;
        const hasExactSchema =
          messages[0]!.content.includes('"required":["translations"]') &&
          targets.every((target) => messages[0]!.content.includes(`"${target.id}"`));
        return {
          statusCode: 200,
          headers: {},
          bodyText: JSON.stringify({
            message: {
              content: hasExactSchema
                ? `\`\`\`json\n${JSON.stringify({
                    translations: targets.map((target) => ({ id: target.id, text: "T" })),
                  })}\n\`\`\``
                : JSON.stringify(Object.fromEntries(targets.map((target) => [target.id, "T"]))),
            },
          }),
        };
      },
    };

    await expect(
      discoverProviderModels(
        {
          jobId: "cloud-refresh",
          kind: "ollama",
          endpoint: "https://ollama.com",
          apiKey: "cloud-secret",
        },
        transport,
      ),
    ).resolves.toEqual(["cloud-model"]);
    const provider = new OllamaProvider(
      {
        endpoint: "https://ollama.com",
        model: "cloud-model",
        apiKey: "cloud-secret",
      },
      transport,
    );
    await expect(provider.testConnection("cloud-test")).resolves.toBeDefined();
    await expect(provider.attempt(makeProviderRequest())).resolves.toMatchObject({
      translations: [{ id: "c1" }, { id: "c2" }],
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/api/tags",
      "/api/version",
      "/api/tags",
      "/api/chat",
      "/api/chat",
      "/api/chat",
    ]);
    for (const request of requests.filter((item) => item.body)) {
      expect(request.body).not.toHaveProperty("format");
      expect(request.body).toHaveProperty("think", false);
      const messages = request.body!.messages as Array<{ content: string }>;
      expect(messages[0]!.content).toContain('"required":["translations"]');
    }
  });

  it("does not let an Ollama Test continue with a Provider built across credential replacement", async () => {
    let epoch = 0;
    let apiKey = "old-secret";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const profile = {
      profileId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      endpoint: "https://ollama.example.test",
      model: "qwen",
    } as Parameters<CredentialScopedProviderCache["get"]>[0];
    const seenHeaders: string[] = [];
    const cache = new CredentialScopedProviderCache(
      () => epoch,
      async (value) => {
        const capturedKey = apiKey;
        await gate;
        return new OllamaProvider(
          { endpoint: value.endpoint, model: value.model!, apiKey: capturedKey },
          {
            request: async (request) => {
              seenHeaders.push(request.headers.Authorization ?? "");
              if (request.url.endsWith("/api/version"))
                return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
              if (request.url.endsWith("/api/tags"))
                return { statusCode: 200, headers: {}, bodyText: '{"models":[{"model":"qwen"}]}' };
              return {
                statusCode: 200,
                headers: {},
                bodyText:
                  '{"message":{"content":"{\\"translations\\":[{\\"id\\":\\"probe\\",\\"text\\":\\"T\\"}]}"}}',
              };
            },
          },
        );
      },
    );

    const stale = cache.get(profile);
    apiKey = "new-secret";
    epoch = 1;
    cache.clearProfile(profile.profileId);
    release();

    await expect(stale).rejects.toMatchObject({ providerCode: "CREDENTIAL_CONTEXT_CHANGED" });
    const current = await cache.get(profile);
    await expect(current.testConnection("fresh-test")).resolves.toMatchObject({ model: "qwen" });
    expect(seenHeaders).toEqual(["Bearer new-secret", "Bearer new-secret", "Bearer new-secret"]);
  });

  it("keeps a deleted profile removed across late lists, duplicate success and Sidebar reopen", () => {
    const deleted = { profileId: "deleted", revision: 1 };
    const retained = { profileId: "retained", revision: 1 };
    let mainState = createProfileListSyncState([deleted, retained]);
    const stale = beginProfileListRequest(mainState, "window-A");
    mainState = stale.state;
    const sidebar = globalThis.createSubTandemSidebarState(mainState.profiles);
    sidebar.beginOperation({
      requestId: "delete-request",
      regionId: "profile-row:deleted",
      actionId: "delete",
      profileId: "deleted",
    });

    mainState = removeDeletedProfile(mainState, "deleted");
    const refresh = beginProfileListRequest(mainState, "window-A");
    mainState = refresh.state;
    sidebar.deleteSucceeded({ requestId: "delete-request", profileId: "deleted", message: "Done" });
    sidebar.deleteSucceeded({ requestId: "delete-request", profileId: "deleted", message: "Done" });

    mainState = acceptProfileListResult(mainState, stale.requestId, [deleted, retained]);
    expect(mainState.profiles).toEqual([retained]);
    sidebar.applyProfiles([deleted, retained]);
    expect(sidebar.snapshot.profiles).toEqual([retained]);

    mainState = acceptProfileListResult(mainState, refresh.requestId, [retained]);
    const reopened = globalThis.createSubTandemSidebarState(mainState.profiles);
    expect(reopened.snapshot.profiles).toEqual([retained]);
  });

  it.each(["openai", "ollama"] as const)(
    "runs remote HTTP %s Save, Test, activation and translation without Test activating it",
    async (kind) => {
      const profiles = new ProviderProfiles(() => `remote-${kind}`);
      const saved = profiles.save({
        displayName: kind,
        kind,
        endpoint:
          kind === "openai"
            ? "http://openai.example.test:8080/v1"
            : "http://ollama.example.test:11434",
        model: "model",
      });
      const transport: ProviderTransport = {
        request: async (request) => {
          if (request.url.endsWith("/api/version"))
            return { statusCode: 200, headers: {}, bodyText: '{"version":"0.10"}' };
          if (request.url.endsWith("/api/tags"))
            return {
              statusCode: 200,
              headers: {},
              bodyText: '{"models":[{"name":"model"}]}',
            };
          const messages = (request.body as { messages: Array<{ content: string }> }).messages;
          const targets = parseTranslationPayload(messages.at(-1)!.content).targets;
          const content = JSON.stringify({
            translations: targets.map((target) => ({ id: target.id, text: `T:${target.text}` })),
          });
          return kind === "openai"
            ? {
                statusCode: 200,
                headers: {},
                bodyText: JSON.stringify({
                  choices: [{ finish_reason: "stop", message: { content } }],
                }),
              }
            : {
                statusCode: 200,
                headers: {},
                bodyText: JSON.stringify({ message: { content } }),
              };
        },
      };
      const createProvider = () =>
        kind === "openai"
          ? new OpenAICompatibleProvider(
              {
                endpoint: saved.endpoint,
                model: "model",
                capability: "json-object",
                sessionId: "session",
              },
              transport,
            )
          : new OllamaProvider({ endpoint: saved.endpoint, model: "model" }, transport);
      const tested = createProvider();

      await expect(tested.testConnection("remote-test")).resolves.toBeDefined();
      const authority = createTestProfileAuthority(profiles);
      const broker = new ProviderBroker(profiles, authority, createProvider);
      expect(authority.snapshot.activation).toBeNull();
      await activateTestProfile(authority, saved, "window");
      await expect(
        broker.attempt(
          "window",
          authorizedProviderRequest(authority, {
            ...makeProviderRequest(),
            profileId: saved.profileId,
            profileRevision: saved.revision,
            endpointFingerprint: saved.endpointFingerprint,
          }),
        ),
      ).resolves.toMatchObject({ translations: [{ id: "c1" }, { id: "c2" }] });
    },
  );

  it("keeps the Main lifecycle identity while the IINA sender owns routing", async () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const calls: string[] = [];
    const provider: TranslationProvider = {
      attempt: async (request) => {
        calls.push(request.playerId);
        return { translations: [{ id: "c1", text: String(request.playerId) }] };
      },
    };
    const saved = profiles.save({
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, saved, "window-A");
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      profileId: saved.profileId,
      profileRevision: saved.revision,
      endpointFingerprint: saved.endpointFingerprint,
    });
    const result = await broker.attempt("window-A", {
      ...request,
      playerId: "spoofed" as typeof request.playerId,
    });
    expect(result.translations).toEqual([{ id: "c1", text: "spoofed" }]);
    expect(calls).toEqual(["spoofed"]);
    await expect(broker.attempt("window-B", request)).resolves.toBeDefined();
  });

  it("routes progress through the authoritative player request and stops after terminal or cancel", async () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const progressHandlers = new Map<string, (text: string) => void>();
    const requestPlayers = new Map<string, string>();
    const resolvers = new Map<
      string,
      (value: { translations: Array<{ id: string; text: string }> }) => void
    >();
    const provider: TranslationProvider = {
      attempt: (request, onProgress) =>
        new Promise((resolve) => {
          requestPlayers.set(request.requestId, request.playerId);
          progressHandlers.set(request.playerId, (text) =>
            onProgress?.({ translations: [{ id: "c1", text }] }),
          );
          resolvers.set(request.playerId, resolve);
        }),
      cancel: (requestId) => {
        const playerId = requestPlayers.get(requestId);
        if (playerId) resolvers.get(playerId)?.({ translations: [] });
      },
    };
    const saved = profiles.save({
      displayName: "OpenAI",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, saved);
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      profileId: saved.profileId,
      profileRevision: saved.revision,
      endpointFingerprint: saved.endpointFingerprint,
    });
    const aProgress: string[] = [];
    const bProgress: string[] = [];
    const aPending = broker.attempt(
      "window-A",
      { ...request, playerId: "main-A" as typeof request.playerId },
      (value) => aProgress.push(value.translations[0]!.text),
    );
    void aPending.catch(() => undefined);
    const bPending = broker.attempt("window-B", { ...request, playerId: "main-B" }, (value) =>
      bProgress.push(value.translations[0]!.text),
    );
    await Promise.resolve();

    progressHandlers.get("main-A")?.("A-first");
    progressHandlers.get("main-B")?.("B-first");
    await broker.cancel("window-A", request.requestId);
    progressHandlers.get("main-A")?.("A-late");
    resolvers.get("main-B")?.({ translations: [{ id: "c1", text: "B-final" }] });
    await expect(aPending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    await bPending;
    progressHandlers.get("main-B")?.("B-late");

    expect(aProgress).toEqual(["A-first"]);
    expect(bProgress).toEqual(["B-first"]);
  });

  it("requires a new global activation after an endpoint revision", async () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    const provider: TranslationProvider = {
      attempt: async (request) => ({
        translations: [{ id: "c1", text: `${request.profileRevision}` }],
      }),
    };
    const first = profiles.save({
      displayName: "Local",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, first, "A");
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const second = profiles.save({
      profileId: first.profileId,
      expectedRevision: 1,
      editingWindowId: "A",
      displayName: "Local",
      kind: "ollama",
      endpoint: "http://localhost:11434",
      model: "m",
    });
    const request = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      profileId: first.profileId,
      profileRevision: 1,
      endpointFingerprint: first.endpointFingerprint,
    });
    await expect(broker.attempt("A", request)).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
    await expect(broker.attempt("B", request)).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
    await activateTestProfile(authority, second, "A");
    await expect(
      broker.attempt(
        "A",
        authorizedProviderRequest(authority, {
          ...makeProviderRequest(),
          profileId: second.profileId,
          profileRevision: second.revision,
          endpointFingerprint: second.endpointFingerprint,
        }),
      ),
    ).resolves.toMatchObject({ translations: [{ text: "2" }] });
  });

  it("rejects the prior global generation and admits the current Profile from another window", async () => {
    let profileSequence = 0;
    const profiles = new ProviderProfiles(() => `profile-${++profileSequence}`);
    const a = profiles.save({
      displayName: "A",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "local-model",
    });
    const b = profiles.save({
      displayName: "B",
      kind: "openai",
      endpoint: "https://b.example.test/v1",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    const broker = new ProviderBroker(profiles, authority, (profile) => ({
      attempt: async (request) => ({
        translations: [{ id: "c1", text: `${request.playerId}:${profile.endpointFingerprint}` }],
      }),
    }));
    await activateTestProfile(authority, a, "A");
    const oldA = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      playerId: "main-A" as ReturnType<typeof makeProviderRequest>["playerId"],
      profileId: a.profileId,
      profileRevision: 1,
      endpointFingerprint: a.endpointFingerprint,
    });
    await activateTestProfile(authority, b, "B");
    await expect(broker.attempt("A", oldA)).rejects.toMatchObject({
      code: "PROFILE_NOT_ACTIVE",
    });
    const bResult = await broker.attempt(
      "B",
      authorizedProviderRequest(authority, {
        ...makeProviderRequest(),
        playerId: "main-B" as ReturnType<typeof makeProviderRequest>["playerId"],
        profileId: b.profileId,
        profileRevision: 1,
        endpointFingerprint: b.endpointFingerprint,
      }),
    );
    expect(bResult.translations[0]?.text).toContain("main-B:");
  });

  it("cancels every in-flight provider job during global shutdown", async () => {
    const profiles = new ProviderProfiles(() => "00000000-0000-4000-8000-000000000001");
    let rejectAttempt: ((reason: unknown) => void) | undefined;
    const cancellations: string[] = [];
    const provider: TranslationProvider = {
      attempt: () =>
        new Promise((_resolve, reject) => {
          rejectAttempt = reject;
        }),
      cancel: async (requestId) => {
        cancellations.push(requestId);
        rejectAttempt?.({ category: "cancelled", retryable: false });
      },
    };
    const saved = profiles.save({
      displayName: "Remote",
      kind: "openai",
      endpoint: "https://example.test/v1",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    await activateTestProfile(authority, saved);
    const broker = new ProviderBroker(profiles, authority, () => provider);
    const pending = broker.attempt(
      "window-A",
      authorizedProviderRequest(authority, {
        ...makeProviderRequest(),
        requestId: "reset-me" as ReturnType<typeof makeProviderRequest>["requestId"],
        profileId: saved.profileId,
        profileRevision: saved.revision,
        endpointFingerprint: saved.endpointFingerprint,
      }),
    );
    void pending.catch(() => undefined);

    await Promise.resolve();
    await broker.cancelAll();
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]).toMatch(/reset-me$/);
    await expect(pending).rejects.toMatchObject({ category: "cancelled" });
  });

  it("cancels only jobs owned by a deleted profile", async () => {
    let sequence = 0;
    const profiles = new ProviderProfiles(() => `profile-${++sequence}`);
    const cancellations: string[] = [];
    const requestPlayers = new Map<string, string>();
    const resolvers = new Map<
      string,
      (value: { translations: Array<{ id: string; text: string }> }) => void
    >();
    const deleted = profiles.save({
      displayName: "Deleted",
      kind: "openai",
      endpoint: "https://deleted.example/v1",
      model: "m",
    });
    const retained = profiles.save({
      displayName: "Retained",
      kind: "openai",
      endpoint: "https://retained.example/v1",
      model: "m",
    });
    const authority = createTestProfileAuthority(profiles);
    const broker = new ProviderBroker(profiles, authority, () => ({
      attempt: (request) =>
        new Promise((resolve) => {
          requestPlayers.set(request.requestId, request.playerId);
          resolvers.set(request.playerId, resolve);
        }),
      cancel: async (requestId) => {
        cancellations.push(requestId);
        const playerId = requestPlayers.get(requestId);
        if (playerId) resolvers.get(playerId)?.({ translations: [] });
      },
    }));
    await activateTestProfile(authority, deleted, "A");
    const aRequest = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      playerId: "main-A" as ReturnType<typeof makeProviderRequest>["playerId"],
      requestId: "delete-A" as ReturnType<typeof makeProviderRequest>["requestId"],
      profileId: deleted.profileId,
      endpointFingerprint: deleted.endpointFingerprint,
    });
    const pendingA = broker.attempt("A", aRequest);
    void pendingA.catch(() => undefined);
    await Promise.resolve();
    await activateTestProfile(authority, retained, "B");
    const bRequest = authorizedProviderRequest(authority, {
      ...makeProviderRequest(),
      playerId: "main-B" as ReturnType<typeof makeProviderRequest>["playerId"],
      requestId: "keep-B" as ReturnType<typeof makeProviderRequest>["requestId"],
      profileId: retained.profileId,
      endpointFingerprint: retained.endpointFingerprint,
    });
    const pendingB = broker.attempt("B", bRequest);
    await Promise.resolve();

    await broker.cancelProfile(deleted.profileId);
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]).toMatch(/delete-A$/);
    resolvers.get("main-B")?.({ translations: [{ id: "c1", text: "still-running" }] });
    await expect(pendingA).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    await expect(pendingB).resolves.toMatchObject({
      translations: [{ text: "still-running" }],
    });
  });
});
