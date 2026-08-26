import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GlobalRpcRouter } from "../../src/adapters/iina/global-rpc.js";
import { GLOBAL_MESSAGE_NAMES, SIDEBAR_MESSAGE_NAMES } from "../../src/domain/messages.js";

describe("authoritative global RPC routing", () => {
  it("invalidates every cached revision and credential context after replacement", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    expect(source).toContain("clearProfileProviderCache(secret.profileId)");
    expect(source).toContain("clearProfileModelCatalogs(secret.profileId)");
    expect(source).toContain("cancelProfileModelRequests(secret.profileId)");
    expect(source).toContain("modelCredentialEpochs.set(");
    expect(source).toContain("providerConnectionTests.cancelProfile(secret.profileId)");
    expect(source).toContain("broker.cancelProfile(secret.profileId)");
  });

  it("allows model refresh across both runtime message boundaries", () => {
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:models");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:models");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:models-preview");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:models-preview");
  });

  it("routes draft credentials only through the strict preview handler", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const start = source.indexOf('onMessage("provider:models-preview"');
    const end = source.indexOf('onMessage("profile:create-revision"', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("parseProviderModelsPreviewRequest");
    expect(handler).toContain("values.credential.apiKey");
    expect(handler).toContain("discoverProviderModels");
    expect(handler).not.toContain("modelCatalogs.set");
    expect(handler).not.toContain("setSecret");
    expect(handler).not.toContain("persistProfileMetadata");
  });
  it("routes provider model requests in the host window scope", async () => {
    const replies: Array<{ playerId: string; name: string; data: unknown }> = [];
    const router = new GlobalRpcRouter((playerId, name, data) =>
      replies.push({ playerId, name, data }),
    );
    router.register("provider:models", async (message, context) => ({
      requestId: message.requestId,
      playerId: context.playerId,
      ok: true,
      contextKey: "opaque",
      models: [],
    }));
    await router.receive("window-a", "provider:models", {
      requestId: "models.window-a.1",
      revision: 1,
      payload: {
        trigger: "manual",
        kind: "openai",
        endpoint: "https://example.test/v1",
        proxyMode: "system",
      },
    });
    expect(replies).toEqual([
      expect.objectContaining({
        playerId: "window-a",
        name: "provider:models:result",
        data: expect.objectContaining({ requestId: "models.window-a.1", playerId: "window-a" }),
      }),
    ]);
  });
  it("uses the host player ID and ignores a spoofed payload ID", async () => {
    const replies: Array<{ playerId: string; name: string; data: unknown }> = [];
    const router = new GlobalRpcRouter((playerId, name, data) =>
      replies.push({ playerId, name, data }),
    );
    router.register("provider:attempt", async (message, context) => ({
      authoritativePlayerId: context.playerId,
      suppliedPlayerId: (message.payload as Record<string, unknown>).playerId,
    }));
    await router.receive("host-player-A", "provider:attempt", {
      requestId: "same-id",
      revision: 1,
      payload: { playerId: "spoofed-player-B" },
    });
    expect(replies[0]).toMatchObject({
      playerId: "host-player-A",
      name: "provider:attempt:result",
    });
    expect(replies[0]?.data).toMatchObject({ authoritativePlayerId: "host-player-A" });
  });

  it("rejects stale revisions and duplicate live request IDs per player", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const replies: unknown[] = [];
    const router = new GlobalRpcRouter((_playerId, _name, data) => replies.push(data));
    router.register("slow", async () => blocked);
    const first = router.receive("A", "slow", { requestId: "r1", revision: 2, payload: {} });
    await router.receive("A", "slow", { requestId: "r1", revision: 2, payload: {} });
    await router.receive("A", "slow", { requestId: "r2", revision: 1, payload: {} });
    release();
    await first;
    expect(replies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ error: expect.objectContaining({ code: "DUPLICATE_REQUEST" }) }),
        expect.objectContaining({ error: expect.objectContaining({ code: "STALE_REVISION" }) }),
      ]),
    );
  });

  it("permits colliding IDs and concurrent work across different players", async () => {
    const routed: string[] = [];
    const router = new GlobalRpcRouter((playerId) => routed.push(playerId));
    router.register("work", async (_message, context) => context.playerId);
    await Promise.all([
      router.receive("A", "work", { requestId: "same", revision: 1, payload: {} }),
      router.receive("B", "work", { requestId: "same", revision: 1, payload: {} }),
    ]);
    expect(routed.sort()).toEqual(["A", "B"]);
  });

  it("keeps provider connection tests with the same external ID scoped to their host players", async () => {
    const routed: Array<{ playerId: string; resultPlayerId: unknown }> = [];
    const router = new GlobalRpcRouter((playerId, _name, data) => {
      routed.push({
        playerId,
        resultPlayerId: (data as Record<string, unknown>).playerId,
      });
    });
    router.register("provider:test", async (message, context) => ({
      playerId: context.playerId,
      profileId: (message.payload as Record<string, unknown>).profileId,
    }));

    await Promise.all([
      router.receive("A", "provider:test", {
        requestId: "same-test",
        revision: 3,
        payload: { profileId: "profile-a", revision: 3 },
      }),
      router.receive("B", "provider:test", {
        requestId: "same-test",
        revision: 3,
        payload: { profileId: "profile-b", revision: 3 },
      }),
    ]);

    expect(routed).toEqual([
      { playerId: "A", resultPlayerId: "A" },
      { playerId: "B", resultPlayerId: "B" },
    ]);
  });
});
