import { describe, expect, it } from "vitest";
import { ProviderConnectionTests } from "../../src/providers/connection-tests.js";
import type { ConfiguredProvider } from "../../src/providers/provider.js";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { ProviderTransportRequest } from "../../src/providers/transport.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

function configuredProvider(cancelled: string[]): ConfiguredProvider {
  return {
    attempt: async (request) => ({
      translations: request.items.map((item) => ({ id: item.id, text: item.text })),
    }),
    testConnection: async (testId) => testId,
    cancel: (testId) => {
      cancelled.push(testId);
    },
  };
}

describe("provider connection test registry", () => {
  it("runs a fresh cancellable Claude Messages Test without selecting its Profile", async () => {
    const requests: ProviderTransportRequest[] = [];
    const profiles = new ProviderProfiles(() => "claude-profile");
    const profile = profiles.save({
      displayName: "Claude",
      kind: "claude",
      endpoint: "https://api.anthropic.com",
      model: "exact-model",
    });
    const provider = new ClaudeProvider(
      { endpoint: profile.endpoint, model: profile.model!, apiKey: "fictional-key" },
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
                    translations: targets.map((target) => ({ id: target.id, text: "ok" })),
                  }),
                },
              ],
            }),
          };
        },
      },
    );
    const registry = new ProviderConnectionTests(() => "claude-test");
    const task = registry.start({
      playerId: "window-a",
      requestId: "external-test",
      profileId: profile.profileId,
      profileRevision: profile.revision,
      provider,
    });

    await expect(provider.testConnection(task.testId)).resolves.toEqual({ model: "exact-model" });
    expect(registry.complete(task.testId)).toEqual(task);
    expect(profiles.selection("window-a")).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("gives colliding external IDs and a shared provider unique internal identities", () => {
    const provider = configuredProvider([]);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "same-request",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "same-request",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });

    expect(first.testId).toBe("test-1");
    expect(second.testId).toBe("test-2");
    expect(registry.activeCount()).toBe(2);
    expect(registry.complete(first.testId)).toEqual(first);
    expect(registry.activeCount()).toBe(1);
    expect(registry.get(second.testId)).toEqual(second);
  });

  it("cancels only matching profile tasks and ignores late completion", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "one",
      profileId: "profile-a",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "two",
      profileId: "profile-b",
      profileRevision: 2,
      provider,
    });

    await registry.cancelProfile("profile-a");

    expect(cancelled).toEqual([first.testId]);
    expect(registry.complete(first.testId)).toBeNull();
    expect(registry.get(second.testId)).toEqual(second);
    expect(second).not.toHaveProperty("selection");
  });

  it("makes individual and global cancellation idempotent", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "one",
      profileId: "profile-a",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "two",
      profileId: "profile-b",
      profileRevision: 1,
      provider,
    });

    await expect(registry.cancel(first.testId)).resolves.toBe(true);
    await expect(registry.cancel(first.testId)).resolves.toBe(false);
    await registry.cancelAll();
    await registry.cancelAll();

    expect(cancelled).toEqual([first.testId, second.testId]);
    expect(registry.activeCount()).toBe(0);
  });

  it("cancels only tests owned by a released player", async () => {
    const cancelled: string[] = [];
    const provider = configuredProvider(cancelled);
    let sequence = 0;
    const registry = new ProviderConnectionTests(() => `test-${++sequence}`);
    const first = registry.start({
      playerId: "player-a",
      requestId: "same",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });
    const second = registry.start({
      playerId: "player-b",
      requestId: "same",
      profileId: "profile",
      profileRevision: 1,
      provider,
    });

    await registry.cancelPlayer("player-a");

    expect(cancelled).toEqual([first.testId]);
    expect(registry.get(first.testId)).toBeNull();
    expect(registry.get(second.testId)).toEqual(second);
  });
});
