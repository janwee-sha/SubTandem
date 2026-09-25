import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GlobalRpcRouter } from "../../src/adapters/iina/global-rpc.js";
import {
  GLOBAL_MESSAGE_NAMES,
  SIDEBAR_MESSAGE_NAMES,
  parseProviderTestResult,
} from "../../src/domain/messages.js";

describe("authoritative global RPC routing", () => {
  it("keeps every Main and Global message off IINA's synchronous cross-context bridge", () => {
    const mainSource = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
    const globalSource = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const mailboxSource = readFileSync(
      new URL("../../src/adapters/iina/global-mailbox.ts", import.meta.url),
      "utf8",
    );
    for (const source of [mainSource, globalSource, mailboxSource]) {
      expect(source).not.toMatch(/iina\.global\.(?:postMessage|onMessage)/);
    }
    expect(mainSource).toContain("new MainGlobalMailbox(");
    expect(globalSource).toContain("new GlobalMailbox(");
  });

  it("routes the complete Claude lifecycle through shared strict RPC names", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    expect(source).toContain('import { ClaudeProvider } from "./providers/claude.js"');
    expect(source).toContain('case "claude"');
    expect(source).toContain("new ClaudeProvider(");
    expect(source).toContain('value.kind !== "claude"');
    expect(source).toContain('value === "claude"');
    for (const name of [
      "profile:create-revision",
      "credential:set",
      "provider:models",
      "provider:test",
      "profile-activation:get",
      "profile-activation:set",
      "provider:attempt",
      "profile:delete",
    ])
      expect(source).toContain(`onMessage("${name}"`);
    expect(source).not.toContain('onMessage("claude:');
  });

  it("runs a keyless Claude draft through the production Global handler", async () => {
    const { globalProviderHarness } = await import("../helpers/global-provider-harness.js");
    const h = await globalProviderHarness();
    const work = h.send("provider:test", {
      kind: "claude",
      endpoint: "https://fixture.test",
      model: "model",
      proxyMode: "direct",
      drawerId: "drawer",
      draftRevision: 1,
      credential: { source: "none" },
    });
    await h.transport.responses.waitForPending();
    expect(h.reads).toEqual([]);
    expect(h.transport.calls[0]!.headers["x-api-key"]).toBeUndefined();
    h.transport.responses.releaseNext({
      statusCode: 200,
      headers: {},
      bodyText: JSON.stringify({
        type: "message",
        role: "assistant",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: JSON.stringify({ translations: [{ id: "c1", text: "hola" }] }) },
        ],
      }),
    });
    await work;
    expect(h.replies.at(-1)).toMatchObject({ name: "provider:test-result", data: { ok: true } });
  });

  it("cancels obsolete Provider work before publishing a changed activation", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const start = source.indexOf('onMessage("profile-activation:set"');
    const end = source.indexOf('onMessage("provider:models"', start);
    const handler = source.slice(start, end);
    expect(handler).toContain('if (result.outcome === "changed") await broker.cancelAll()');
    expect(handler.indexOf("await broker.cancelAll()")).toBeLessThan(
      handler.indexOf('postToPlayer(playerId, "profile-activation:result"'),
    );
    expect(handler.indexOf("await broker.cancelAll()")).toBeLessThan(
      handler.indexOf("publishProfileAuthority()"),
    );
  });

  it("isolates startup pagination from a cancelled drawer", async () => {
    const { globalProviderHarness } = await import("../helpers/global-provider-harness.js");
    const { ProviderProfiles } = await import("../../src/providers/profiles.js");
    const profiles = new ProviderProfiles(() => "saved");
    const saved = profiles.save({
      kind: "claude",
      endpoint: "https://fixture.test",
      model: "model",
      displayName: "Profile",
    });
    const h = await globalProviderHarness([saved]);
    await h.startup[0]!();
    await h.secrets.waitForPending();
    h.secrets.releaseNext({ apiKey: "saved-key" });
    await h.transport.responses.waitForPending();
    const startupJob = h.transport.calls[0]!.jobId;
    const drawer = h.send("provider:models", {
      kind: "claude",
      endpoint: "https://other.test",
      proxyMode: "direct",
      trigger: "manual",
    });
    await h.transport.responses.waitForPending(2);
    await h.send("provider:models-cancel", { modelRequestId: "request" }, "window", "cancel");
    const respond = (body: unknown) => ({
      statusCode: 200,
      headers: {},
      bodyText: JSON.stringify(body),
    });
    h.transport.responses.releaseNext(
      respond({ data: [{ id: "one" }], has_more: true, last_id: "next" }),
    );
    h.transport.responses.releaseNext(respond({ data: [], has_more: false }));
    await drawer;
    await h.transport.responses.waitForPending();
    expect(h.transport.calls[2]!.url).toContain("after_id=next");
    expect(h.transport.calls[2]!.jobId).toBe(startupJob);
    expect(h.transport.cancelled).not.toContain(startupJob);
    h.transport.responses.releaseNext(respond({ data: [{ id: "two" }], has_more: false }));
  });

  it("invalidates every cached revision and credential context after replacement", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    expect(source).toContain("clearProfileProviderCache(secret.profileId)");
    expect(source).toContain("clearProfileModelCatalogs(secret.profileId)");
    expect(source).toContain("cancelProfileModelRequests(secret.profileId)");
    expect(source).toContain("modelCredentialEpochs.set(");
    expect(source).toContain("invalidateProfileConnectionTests(secret.profileId)");
    expect(source).toContain("broker.cancelProfile(secret.profileId)");
  });

  it("commits a converted revision, advances credential ownership, then clears runtime owners", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const start = source.indexOf('onMessage("profile:create-revision"');
    const end = source.indexOf('onMessage("profile:delete"', start);
    const handler = source.slice(start, end);
    const kindChange = handler.indexOf("currentProfile.kind !== kind");
    const save = handler.indexOf("profileAuthority.saveProfile", kindChange);
    const epoch = handler.indexOf("advanceCredentialEpoch(profile.profileId)", save);
    const cancel = handler.indexOf("broker.cancelProfile(profile.profileId)", epoch);

    expect(kindChange).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(kindChange);
    expect(epoch).toBeGreaterThan(save);
    expect(cancel).toBeGreaterThan(epoch);
    expect(handler).toContain("invalidateProfileConnectionTests(profile.profileId)");
    expect(handler).not.toContain("deleteSecret");
  });

  it("advances credential ownership when a Profile is deleted", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const start = source.indexOf('onMessage("profile:delete"');
    const end = source.indexOf('onMessage("credential:set"', start);
    const handler = source.slice(start, end);
    expect(handler).toContain("advanceCredentialEpoch(profileId)");
    expect(handler).not.toContain("modelCredentialEpochs.delete(profileId)");
  });

  it("allows model refresh across both runtime message boundaries", () => {
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:models");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:models");
    expect(SIDEBAR_MESSAGE_NAMES).toContain("provider:models-preview");
    expect(GLOBAL_MESSAGE_NAMES).toContain("provider:models-preview");
  });

  it("keeps DeepSeek on the existing provider RPC names", () => {
    expect(GLOBAL_MESSAGE_NAMES).not.toContain("deepseek:models");
    expect(GLOBAL_MESSAGE_NAMES).not.toContain("deepseek:test");
    expect(GLOBAL_MESSAGE_NAMES).toEqual(
      expect.arrayContaining(["provider:models", "provider:test", "provider:attempt"]),
    );
  });

  it("routes draft credentials only through the strict preview handler", async () => {
    const { globalProviderHarness } = await import("../helpers/global-provider-harness.js");
    const h = await globalProviderHarness();
    const preview = h.send("provider:models-preview", {
      trigger: "manual",
      kind: "openai",
      endpoint: "https://fixture.test",
      proxyMode: "direct",
      draftCredentialEpoch: 1,
      credential: { apiKey: "entered-key" },
    });
    await h.transport.responses.waitForPending();
    expect(h.transport.calls[0]!.headers.Authorization).toBe("Bearer entered-key");
    expect(h.reads).toEqual([]);
    h.transport.responses.releaseNext({
      statusCode: 200,
      headers: {},
      bodyText: '{"data":[{"id":"model"}]}',
    });
    await preview;
    expect(h.replies.at(-1)?.data).toMatchObject({ ok: true, models: ["model"] });
    expect(h.profiles.listLatest()).toEqual([]);
    expect(JSON.stringify(h.replies)).not.toContain("entered-key");
  });

  it("allows only the fixed unknown Provider sentinel across the Test result wire", () => {
    const source = readFileSync(new URL("../../src/global.ts", import.meta.url), "utf8");
    const messages = readFileSync(new URL("../../src/domain/messages.ts", import.meta.url), "utf8");
    const safeUnknown = {
      requestId: "test-unknown-1",
      drawerId: "drawer-1",
      draftRevision: 1,
      ok: false,
      category: "protocol",
      retryable: false,
      code: "UNKNOWN_PROVIDER_ERROR",
      userAction: "NONE",
    };

    expect(parseProviderTestResult(safeUnknown)).toEqual(safeUnknown);
    expect(source).toContain('"UNKNOWN_PROVIDER_ERROR"');
    expect(messages).toContain('"UNKNOWN_PROVIDER_ERROR"');
    for (const code of ["invalid_api_key", "provider-private-code", "raw_502_body"])
      expect(() => parseProviderTestResult({ ...safeUnknown, code })).toThrow("INVALID_MESSAGE");
    for (const field of ["responseBody", "body", "credential", "subtitle", "endpoint"])
      expect(() => parseProviderTestResult({ ...safeUnknown, [field]: "must-not-cross" })).toThrow(
        "INVALID_MESSAGE",
      );
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
